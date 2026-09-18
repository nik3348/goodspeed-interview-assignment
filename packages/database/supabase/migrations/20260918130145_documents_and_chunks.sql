-- Documents, their embedded chunks, and the retrieval function the RAG
-- pipeline queries.
--
-- Authorization lives here, in row-level security, rather than in the API.
-- The NestJS layer forwards each caller's access token to PostgREST, so every
-- statement below is evaluated as that user: a forgotten `where user_id = ...`
-- in application code cannot leak another user's rows.

-- pgvector. Supabase installs extensions into `extensions` rather than
-- `public`, so the type is schema-qualified throughout.
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint documents_title_not_blank check (btrim(title) <> ''),
  constraint documents_title_length check (char_length(title) <= 200),
  -- An upper bound keeps one paste from producing thousands of embedding
  -- calls. Generous enough for a long article.
  constraint documents_content_length check (char_length(content) <= 1000000)
);

comment on table public.documents is
  'User-authored source material for retrieval-augmented chat.';

-- The list view is "my documents, most recently touched first", so the index
-- covers the filter and the sort together.
create index documents_user_id_updated_at_idx
  on public.documents (user_id, updated_at desc);

-- Tag filtering uses array containment, which needs GIN.
create index documents_tags_idx on public.documents using gin (tags);

-- ---------------------------------------------------------------------------
-- document_chunks
-- ---------------------------------------------------------------------------

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  -- Denormalised from `documents` so the RLS policy is a column comparison
  -- rather than a subquery evaluated per candidate row. Kept honest by
  -- `document_chunks_set_user_id`, below.
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  token_count integer,
  -- 1536 matches OpenAI's text-embedding-3-* family. A provider whose
  -- embeddings have a different width needs a migration; the API refuses to
  -- start if its configured model disagrees with this column.
  embedding extensions.vector(1536),
  -- Which model produced `embedding`, so a provider switch is detectable and
  -- the affected rows can be re-embedded rather than silently mixed.
  embedding_model text not null,
  created_at timestamptz not null default now(),

  constraint document_chunks_chunk_index_non_negative check (chunk_index >= 0),
  constraint document_chunks_document_id_chunk_index_key
    unique (document_id, chunk_index)
);

comment on table public.document_chunks is
  'Embedded segments of a document. Rebuilt whenever the document changes.';

-- Rebuilding a document deletes its chunks; retrieval joins back to titles.
create index document_chunks_document_id_idx
  on public.document_chunks (document_id);

-- Supports the RLS predicate.
create index document_chunks_user_id_idx
  on public.document_chunks (user_id);

-- HNSW over IVFFlat: it needs no training pass, so it behaves well on a table
-- that starts empty and grows continuously, which is exactly this workload.
-- Cosine distance is the safe default — it holds whether or not the configured
-- provider returns normalised vectors.
create index document_chunks_embedding_idx
  on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- A chunk belongs to whoever owns its document. Deriving the column here
-- rather than trusting the caller means the denormalisation cannot drift, and
-- a chunk cannot be filed under another user.
create or replace function public.set_chunk_user_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select d.user_id into new.user_id
  from public.documents d
  where d.id = new.document_id;

  if new.user_id is null then
    raise exception 'document % does not exist', new.document_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger document_chunks_set_user_id
  before insert or update of document_id on public.document_chunks
  for each row execute function public.set_chunk_user_id();

-- ---------------------------------------------------------------------------
-- row-level security
-- ---------------------------------------------------------------------------

alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;

-- `(select auth.uid())` is evaluated once per statement instead of once per
-- row. `to authenticated` scopes the policy to signed-in callers; the
-- ownership predicate is what actually restricts the rows.
create policy documents_select_own on public.documents
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy documents_insert_own on public.documents
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- `with check` as well as `using`: without it a user could hand a row to
-- someone else by rewriting user_id.
create policy documents_update_own on public.documents
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy documents_delete_own on public.documents
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy document_chunks_select_own on public.document_chunks
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy document_chunks_insert_own on public.document_chunks
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy document_chunks_update_own on public.document_chunks
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy document_chunks_delete_own on public.document_chunks
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- retrieval
-- ---------------------------------------------------------------------------

-- Similarity search over the caller's chunks.
--
-- `security invoker` is the point: the function runs as the calling user, so
-- the policies above filter the candidate set. There is deliberately no
-- `user_id` parameter — retrieval cannot be aimed at another account.
create or replace function public.match_document_chunks (
  query_embedding extensions.vector(1536),
  match_threshold double precision default 0.2,
  match_count integer default 8,
  filter_document_ids uuid[] default null
)
returns table (
  id uuid,
  document_id uuid,
  document_title text,
  chunk_index integer,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.document_id,
    d.title as document_title,
    c.chunk_index,
    c.content,
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.embedding is not null
    -- Narrowing to specific documents happens inside the query so the planner
    -- can combine it with the vector predicate.
    and (filter_document_ids is null or c.document_id = any (filter_document_ids))
    and 1 - (c.embedding operator(extensions.<=>) query_embedding) >= match_threshold
  order by c.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 200);
$$;

comment on function public.match_document_chunks is
  'Cosine similarity search over the calling user''s document chunks.';

-- ---------------------------------------------------------------------------
-- privileges
-- ---------------------------------------------------------------------------

-- Signed-in users reach these through PostgREST with their own token; RLS
-- decides which rows they see. Anonymous callers have no business here at all.
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_chunks to authenticated;
grant execute on function public.match_document_chunks (
  extensions.vector(1536), double precision, integer, uuid[]
) to authenticated;

revoke all on public.documents from anon;
revoke all on public.document_chunks from anon;
revoke all on function public.match_document_chunks (
  extensions.vector(1536), double precision, integer, uuid[]
) from anon;
