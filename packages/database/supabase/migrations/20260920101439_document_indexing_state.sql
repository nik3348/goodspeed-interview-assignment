-- Records whether a document's chunks are current.
--
-- Embedding is a network call to a third party, so it fails in ways writing a
-- row does not: quota, rate limits, an unreachable provider. Without somewhere
-- to record that, a failure leaves a document that looks fine in the list and
-- is silently absent from every answer. These two columns make the difference
-- visible, and therefore retryable.

alter table public.documents
  add column indexed_at timestamptz,
  add column indexing_error text;

comment on column public.documents.indexed_at is
  'When the current content was last embedded. Null means never, or stale.';

comment on column public.documents.indexing_error is
  'Why the last indexing attempt failed. Null when it succeeded or is pending.';

-- Editing a document invalidates its embeddings. Clearing the state in the
-- same statement that changes the content means the two cannot disagree, even
-- if the application crashes between the write and the re-embed.
create or replace function public.clear_indexing_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.content is distinct from old.content then
    new.indexed_at = null;
    new.indexing_error = null;
  end if;

  return new;
end;
$$;

create trigger documents_clear_indexing_state
  before update of content on public.documents
  for each row execute function public.clear_indexing_state();

-- Finding what still needs work: small and skewed, so a partial index keeps it
-- to the rows that actually qualify rather than the whole table.
create index documents_pending_indexing_idx
  on public.documents (user_id, updated_at)
  where indexed_at is null;
