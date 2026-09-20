-- Conversations, their messages, and the chunks each answer was drawn from.
--
-- Same authorization model as documents: ownership is denormalised onto every
-- table so each policy is a column comparison, and a trigger derives it from
-- the parent so the value cannot drift or be spoofed by the caller.

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint conversations_title_length check (char_length(title) <= 200)
);

comment on table public.conversations is
  'A chat session. Persisted, so history survives a page reload.';

-- The sidebar is "my conversations, most recent first".
create index conversations_user_id_updated_at_idx
  on public.conversations (user_id, updated_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- A monotonic sequence rather than a timestamp: two messages written in the
  -- same round trip can share a created_at, and a conversation that renders in
  -- the wrong order is worse than one that renders slowly.
  seq bigint generated always as identity,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Usage and model are recorded per assistant message, which is what makes a
  -- cost breakdown possible without a separate metering system.
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  created_at timestamptz not null default now(),

  constraint messages_content_length check (char_length(content) <= 100000)
);

comment on table public.messages is
  'One turn of a conversation. Assistant turns carry the model and its usage.';

create index messages_conversation_id_seq_idx
  on public.messages (conversation_id, seq);

create index messages_user_id_idx on public.messages (user_id);

-- ---------------------------------------------------------------------------
-- message_citations
-- ---------------------------------------------------------------------------

create table public.message_citations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Position in the answer's citation list, so [1] means the same thing to the
  -- model, the database and the UI.
  rank integer not null,

  -- The chunk is a weak reference on purpose. Editing a document deletes and
  -- rebuilds its chunks, so a hard reference would either block the edit or
  -- vanish from answers already given.
  chunk_id uuid references public.document_chunks (id) on delete set null,
  document_id uuid references public.documents (id) on delete set null,

  -- Snapshot of what was actually shown to the model. An answer must remain
  -- explicable after the source is edited or deleted, and the alternative is a
  -- citation that silently changes meaning under a reader.
  document_title text not null,
  excerpt text not null,
  similarity double precision not null,

  created_at timestamptz not null default now(),

  constraint message_citations_rank_positive check (rank >= 1),
  constraint message_citations_message_id_rank_key unique (message_id, rank)
);

comment on table public.message_citations is
  'Which chunks informed an answer, snapshotted so it stays explicable.';

create index message_citations_message_id_idx
  on public.message_citations (message_id);

create index message_citations_user_id_idx
  on public.message_citations (user_id);

-- ---------------------------------------------------------------------------
-- ownership triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_message_user_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select c.user_id into new.user_id
  from public.conversations c
  where c.id = new.conversation_id;

  if new.user_id is null then
    raise exception 'conversation % does not exist', new.conversation_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger messages_set_user_id
  before insert or update of conversation_id on public.messages
  for each row execute function public.set_message_user_id();

create or replace function public.set_citation_user_id()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  select m.user_id into new.user_id
  from public.messages m
  where m.id = new.message_id;

  if new.user_id is null then
    raise exception 'message % does not exist', new.message_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger message_citations_set_user_id
  before insert or update of message_id on public.message_citations
  for each row execute function public.set_citation_user_id();

-- ---------------------------------------------------------------------------
-- row-level security
-- ---------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_citations enable row level security;

create policy conversations_select_own on public.conversations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy conversations_insert_own on public.conversations
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy conversations_update_own on public.conversations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy conversations_delete_own on public.conversations
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy messages_select_own on public.messages
  for select to authenticated using ((select auth.uid()) = user_id);
create policy messages_insert_own on public.messages
  for insert to authenticated with check ((select auth.uid()) = user_id);
-- No update policy: a transcript is append-only. Editing what was said would
-- make the citations attached to it dishonest.
create policy messages_delete_own on public.messages
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy message_citations_select_own on public.message_citations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy message_citations_insert_own on public.message_citations
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy message_citations_delete_own on public.message_citations
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- privileges
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select, insert, delete on public.message_citations to authenticated;

revoke all on public.conversations from anon;
revoke all on public.messages from anon;
revoke all on public.message_citations from anon;
