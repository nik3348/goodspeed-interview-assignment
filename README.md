# Knowledge base

Write documents, then ask questions about them. Answers are drawn only from
what you have written, and every claim points at the passage it came from.

A Turborepo monorepo: Next.js on the front, NestJS behind it, Supabase with
pgvector underneath, and an AI layer that any OpenAI-compatible provider can
be dropped into by configuration.

## Walkthroughs

- **The app** — https://www.loom.com/share/3f477b95612d49f4b2030811e51924f4
- **How I used AI to build it** — https://www.loom.com/share/210233a014814429a6b7dfbc6d14072c

## Quick start

You need [Node 24.11+](https://nodejs.org), [pnpm 12](https://pnpm.io), and a
free [Supabase](https://supabase.com/dashboard) project.

```bash
pnpm install && pnpm setup
```

`pnpm setup` is safe to run repeatedly. It creates your `.env.local` files from
the checked-in examples, tells you exactly which values are still missing, and
once it has them, applies the migrations and regenerates the database types. It
will stop and ask you to do two things it cannot do for you:

1. **Fill in the env files** it just created. Every variable is commented in
   place, and [Environment variables](#environment-variables) below covers them.
2. **Link the checkout to your Supabase project:**

   ```bash
   pnpm db:link --project-ref <your-project-ref>
   ```

   The ref is the subdomain of your project URL. The CLI will ask for the
   database password you chose when you created the project.

Run `pnpm setup` once more and it will push the schema. Then:

```bash
pnpm dev
```

|     |                         |
| --- | ----------------------- |
| Web | <http://localhost:3001> |
| API | <http://localhost:3000> |

Create an account at <http://localhost:3001/sign-up>. If your Supabase project
has email confirmation enabled (the default), use the confirmation link, or
turn it off under **Authentication → Sign In / Up → Email**.

### Everything else

```bash
pnpm dev            # both apps, with shared packages built first
pnpm build          # production build of everything
pnpm test           # unit tests
pnpm test:e2e       # API end-to-end tests
pnpm lint           # ESLint across the workspace
pnpm check-types    # tsc --noEmit across the workspace

pnpm db:new <name>  # create an empty migration
pnpm db:push        # apply pending migrations to the linked project
pnpm db:types       # regenerate database types from the live schema
pnpm db:status      # which migrations are applied
pnpm db:advisors    # Supabase security and performance advisors
```

## What is in the repo

```
apps/
  web/                  Next.js 16 (App Router). Auth screens, documents, chat.
  api/                  NestJS 12. Documents, RAG pipeline, chat.
packages/
  database/             Migrations, generated types, Supabase CLI scripts.
  contracts/            Zod schemas shared by both apps.
  ui/                   Shared React components.
  eslint-config/        ESLint, including Prettier.
  jest-config/          Jest presets for Nest and Next.
  typescript-config/    Base tsconfigs.
```

The API is organised by capability rather than by layer:

```
apps/api/src/
  ai/                   Provider-agnostic model interfaces
    openai/             The only directory that imports `openai`
  auth/                 Supabase JWT verification, global guard
  supabase/             Typed clients, PostgREST error translation
  documents/            Document CRUD
  indexing/             Chunking and embedding
  chat/                 Retrieval, prompt construction, conversations
  config/               Environment schema, validated at boot
  common/               Error envelope, Zod validation pipe
```

## Architecture decisions

### Supabase Auth stays in Next; all data goes through NestJS

Auth is the one Supabase feature the frontend talks to directly.
`@supabase/ssr` already owns cookie handling and refresh-token rotation, and
proxying that through NestJS would mean reimplementing both to reach the same
hosted endpoint. Supabase Auth is an external identity provider; Next is the
session-holding edge.

Everything else — documents, chunks, embeddings, conversations — goes through
NestJS. Not dogma: the RAG pipeline and the AI provider configuration have to
live server-side anyway, and splitting data access across two tiers would mean
two places that could each get authorization subtly wrong.

```
Browser ──sign in──────────────────► Supabase Auth
Browser ──Bearer <token>───────────► NestJS ──► Postgres (RLS, as the caller)
                                           └──► AI provider (server-only key)
```

The browser calls NestJS directly with the access token rather than routing
through Next. It avoids a second hop, keeps SSE streaming simple, and gains no
security: the `@supabase/ssr` cookies are already JavaScript-readable.

### Authorization lives in the database

Every request-scoped Supabase client forwards the caller's JWT, so Postgres
evaluates row-level security as that user. This is why no service method
filters on `user_id` — doing so would duplicate the policy and imply the
database was not already enforcing it.

The consequence worth noticing: a row owned by someone else is not _forbidden_,
it is _invisible_. An update or delete against it matches nothing and surfaces
as a 404. That is the right answer — distinguishing "does not exist" from
"exists but is not yours" would leak the existence of other users' documents.

Two supporting choices:

- **Ownership is denormalised** onto `document_chunks`, `messages` and
  `message_citations`, so each policy is a column comparison rather than a
  subquery evaluated per candidate row. A trigger derives the value from the
  parent, so it cannot drift or be set by the caller.
- **`(select auth.uid())`**, not `auth.uid()`, so the function is evaluated
  once per statement instead of once per row.

The service-role key is optional and unused on the request path. It exists for
privileged background work that has no user to act as, and
`SupabaseService.admin` fails loudly if reached without one.

### One definition of every payload

`packages/contracts` holds Zod schemas that both apps import. The API validates
requests with them through a small `ZodValidationPipe`; the web app validates
responses with the same schemas, so a contract drift fails at the boundary
rather than three components deep.

This is why Nest's stock `ValidationPipe` is not used: it infers rules from
`class-validator` decorators, which would mean describing every payload twice —
once as a decorated class for the API, once as a type for the web app.

`packages/database` is the other half: `database.types.ts` is generated from the
live schema and committed, so a column rename in a migration surfaces as a
build error rather than a runtime `undefined`.

### Migrations are forward-only

Imperative SQL, one file per change, committed in order, applied with
`pnpm db:push`. A migration is never edited once pushed; a correction is a new
migration. The schema is therefore reproducible from an empty project, which is
what makes a fresh clone runnable.

Turborepo's role here is deliberately small. Migrations are side-effecting and
talk to a remote project, so they are pass-through scripts rather than cacheable
tasks. What Turborepo does own is the generated types, which `apps/api` depends
on like any other build output.

### Chunking: structure first, size second

`apps/api/src/indexing/chunker.ts`. Roughly 1200 characters per chunk (~300
tokens) with 180 characters of overlap.

- **Split on paragraphs, pack greedily.** A fixed-width window routinely cuts a
  sentence in half, and half a sentence embeds to a point in vector space that
  means neither of the things it was between. Oversized paragraphs fall back to
  sentence boundaries, and only then to a hard cut.
- **Headings travel with their content.** A retrieved chunk arrives with no
  surrounding document. "It costs £40 a month" is useless without the heading
  that said what "it" is, so each chunk is prefixed with the heading it sits
  under — and with _every_ heading it spans, not just the first.
- **Neighbours overlap.** A fact straddling a boundary would otherwise be
  missing from both chunks' embeddings. The overlap is snapped to a sentence
  boundary so the repeated text is itself coherent.
- **Characters, not tokens.** Every tokenizer is tied to a model family, which
  would undo the point of a provider-agnostic layer. The token count reported
  alongside each chunk is an estimate for cost display, never for enforcing a
  provider's limit.

Why ~300 tokens: small enough that a hit points at a paragraph rather than a
page, and that several chunks fit in a prompt alongside the conversation; large
enough to hold a complete thought, which matters because a chunk is embedded as
a single point and a fragment lands somewhere meaningless.

### Indexing: embed first, then swap

`IndexingService` embeds the new chunks _before_ deleting the old ones.
Embedding is a third-party network call and the likeliest step to fail, so this
ordering means a provider outage costs the user their fresh embeddings rather
than emptying the index and leaving the document unanswerable.

A failure is recorded on the document rather than thrown. `documents` carries
`indexed_at` and `indexing_error`, a trigger clears them whenever `content`
changes so the flags cannot disagree with the text, and the state is surfaced in
the UI with a retry. A document that saved but could not be embedded is a real
state worth naming — rejecting the write would lose what the user typed, and
silently accepting it would produce a document that never appears in an answer
and cannot be diagnosed from the outside.

Metadata-only edits skip re-embedding: retitling does not change what the text
means.

### Retrieval and prompt construction

`match_document_chunks` is a `security invoker` SQL function that takes no user
id. Row-level security decides whose chunks are searched, so retrieval
structurally cannot be aimed at another account. Filtering and ranking happen
inside the function so the planner can combine them with the vector predicate.

- **HNSW over IVFFlat**, because it needs no training pass and so behaves on a
  table that starts empty and grows continuously.
- **Cosine distance**, which holds whether or not the configured provider
  returns normalised vectors — and the provider is swappable.
- **Follow-ups carry context.** "Why is that?" embeds to almost nothing on its
  own, so the last couple of turns are folded into the search text with the
  question last, keeping it dominant in the resulting vector. A model call to
  rewrite the query properly would retrieve better at the cost of a round trip
  before every search; this buys most of the benefit for free.

The prompt puts retrieved context in the **system message**, rebuilt for every
question. Appending it to the transcript instead would let stale context from
earlier turns compete with what was retrieved for the question actually being
asked, and would grow the prompt without bound. Sources are taken in rank order
until a character budget runs out, and a source that does not fit is **dropped
whole rather than truncated** — half a quotation invites the model to complete
the thought itself, which is the failure the prompt exists to prevent.

### Citations are snapshots

`message_citations` stores the document title and excerpt that were actually
shown to the model, not a join onto the live row. Editing a document deletes and
rebuilds its chunks, so a hard reference would either block the edit or silently
vanish from answers already given. The chunk and document references are
nullable for the same reason: an answer must stay explicable after its source is
edited or deleted, and the UI says so when it has been.

`messages` has no update policy. A transcript is append-only — editing what was
said would make the citations attached to it dishonest.

### The AI layer

See [Swapping AI providers](#swapping-ai-providers) below for how to use it.
The design:

```
ai/
  messages.ts           ChatMessage, ChatCompletion, TokenUsage, EmbeddingResult
  chat-model.ts         ChatModel      — complete() and stream()
  embedding-model.ts    EmbeddingModel — embed(), dimensions, maxBatchSize
  ai.errors.ts          AiRateLimitError, AiContextLengthError, …
  ai.module.ts          the one place a provider is chosen
  openai/               the only directory that imports `openai`
```

Application code depends on two interfaces described in the domain's own
vocabulary, never on a vendor's SDK types. Because OpenAI, Groq, Together,
OpenRouter and Ollama all speak the same wire format, one adapter covers all of
them and the choice is a base URL — but the interface would equally admit a
provider that does not. That would mean writing a second adapter and changing
one branch in `AiModule`, with no caller changes. That is the difference between
"works with one provider" and genuinely swappable.

Three things the layer owns so callers do not have to:

- **Errors are normalised** into a domain hierarchy. A rejected key or an
  unreachable provider is reported as _our_ failure (500/503), never the
  caller's; only an oversized prompt becomes a 4xx. Retry policy written once
  survives a provider swap.
- **Batching**, with results reordered by the index the API returns rather than
  by arrival order.
- **Vector width is checked twice** — at boot against the column the migration
  declares, and per response against what the model actually returned. The error
  names both ways out.

`stream()` ends with one assembled completion, so a consumer that ignores the
deltas receives exactly what `complete()` would have returned. This is why
streaming is not a second implementation of the chat pipeline: both paths share
`prepare()` and `finish()`.

### Errors have one shape

Every API failure is an `ApiError` — `{ statusCode, code, message }` — so the
web app has one shape to narrow on instead of guessing at Nest's defaults.
Internals are logged and never returned. `ApiExceptionFilter` is registered
through DI rather than in `bootstrap`, so tests built from `AppModule` behave
like production.

## Swapping AI providers

Configuration only. No application code is aware of which provider is
configured.

```bash
# OpenAI
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_CHAT_MODEL=gpt-4o-mini
AI_EMBEDDING_MODEL=text-embedding-3-small

# Groq  (chat; pair with an embedding endpoint — see the split setup below)
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=gsk_...
AI_CHAT_MODEL=llama-3.3-70b-versatile

# Together AI
AI_BASE_URL=https://api.together.xyz/v1
AI_API_KEY=...
AI_CHAT_MODEL=meta-llama/Llama-3.3-70B-Instruct-Turbo
AI_EMBEDDING_MODEL=BAAI/bge-large-en-v1.5

# OpenRouter
AI_BASE_URL=https://openrouter.ai/api/v1
AI_API_KEY=sk-or-...
AI_CHAT_MODEL=deepseek/deepseek-v4.1-flash
AI_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
AI_EMBEDDING_DIMENSIONS=1536

# Local Ollama  (no key needed)
AI_BASE_URL=http://localhost:11434/v1
AI_API_KEY=
AI_CHAT_MODEL=llama3.1
AI_EMBEDDING_MODEL=nomic-embed-text
```

Chat and embeddings each take an optional endpoint override, both falling back
to `AI_BASE_URL` and `AI_API_KEY`. So the common case stays two variables, while
a split deployment — hosted chat, local embeddings — is still expressible:

```bash
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=gsk_...
AI_CHAT_MODEL=llama-3.3-70b-versatile

AI_EMBEDDING_BASE_URL=http://localhost:11434/v1
AI_EMBEDDING_MODEL=nomic-embed-text
```

### The one real constraint: embedding width

`document_chunks.embedding` is `vector(1536)`. This is the honest limit of
"configuration only", and the code is explicit about it rather than failing
mysteriously:

- Providers whose model natively returns 1536 dimensions work unchanged
  (OpenAI's `text-embedding-3-small`).
- Providers that support truncation work by setting
  `AI_EMBEDDING_DIMENSIONS=1536`, which is sent with the request. OpenRouter's
  `qwen3-embedding-8b` returns 4096 natively and truncates cleanly this way.
- Anything else needs a migration altering the column and its index. The error
  message says so, names the column, and names both ways out.

Each chunk records the model that produced it, so a provider switch is
detectable rather than silently mixing vector spaces. After switching embedding
providers, re-embed existing documents — the reindex endpoint
(`POST /documents/:id/reindex`) is exposed in the UI as the retry on a failed
document.

## Environment variables

Both `.env.example` files are commented in place; `pnpm setup` copies them for
you. The short version:

### `apps/api/.env.local`

| Variable                                         | Required | Notes                                                                                  |
| ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------- |
| `PORT`                                           | no       | Defaults to `3000`.                                                                    |
| `SUPABASE_URL`                                   | **yes**  | Project URL.                                                                           |
| `SUPABASE_PUBLISHABLE_KEY`                       | **yes**  | Used for the per-request client that carries the caller's token, so RLS still applies. |
| `SUPABASE_SECRET_KEY`                            | no       | Bypasses RLS. Unused on the request path; reserved for privileged background work.     |
| `WEB_ORIGINS`                                    | no       | Comma-separated CORS allowlist. Defaults to `http://localhost:3001`.                   |
| `AI_BASE_URL`                                    | no       | Defaults to OpenAI.                                                                    |
| `AI_API_KEY`                                     | **yes**  | Except for a local Ollama, which needs none.                                           |
| `AI_CHAT_MODEL`                                  | no       | Defaults to `gpt-4o-mini`.                                                             |
| `AI_EMBEDDING_MODEL`                             | no       | Defaults to `text-embedding-3-small`.                                                  |
| `AI_CHAT_BASE_URL` / `AI_CHAT_API_KEY`           | no       | Override the chat endpoint only.                                                       |
| `AI_EMBEDDING_BASE_URL` / `AI_EMBEDDING_API_KEY` | no       | Override the embedding endpoint only.                                                  |
| `AI_EMBEDDING_DIMENSIONS`                        | no       | Requests a specific width. Must be 1536; refused at boot otherwise.                    |
| `AI_EMBEDDING_BATCH_SIZE`                        | no       | Inputs per request. Defaults to `96`.                                                  |
| `AI_REQUEST_TIMEOUT_MS`                          | no       | Defaults to `60000`.                                                                   |
| `AI_MAX_RETRIES`                                 | no       | Defaults to `2`.                                                                       |

### `apps/web/.env.local`

| Variable                               | Required | Notes                                                                            |
| -------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | **yes**  | Same project URL.                                                                |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **yes**  | Public by design; the database is protected by RLS, not by hiding this.          |
| `NEXT_PUBLIC_API_URL`                  | **yes**  | Must match the API's `PORT`, and this app's origin must appear in `WEB_ORIGINS`. |

No secret belongs in the web env file — everything there is `NEXT_PUBLIC_` and
ships to the browser.

The API validates its whole environment at boot with Zod, so a misconfigured
deployment fails immediately with a readable list rather than on the first
request that happens to need the value. Blank values are treated as unset, so an
unfilled placeholder falls through to its default instead of failing validation.

## Tests

174 automated tests: 149 API unit, 15 API end-to-end, 10 web unit.

```bash
pnpm test && pnpm test:e2e
```

They concentrate on the things that fail quietly:

- **The chunker** — heading retention across section boundaries, overlap,
  oversized paragraphs, and not losing words.
- **The AI adapters** — a config-only swap to Groq, a split chat/embedding
  deployment, provider error mapping, batch splitting and result reordering,
  and stream assembly.
- **The indexing pipeline** — that embedding happens _before_ the old chunks are
  deleted, asserted on the full operation timeline rather than on both calls
  merely happening.
- **The SSE reader** — frames split mid-payload, several frames in one read, a
  multi-byte character straddling a boundary, and a malformed frame not killing
  the rest of an answer.
- **Route protection** — every documents and conversations route returns 401
  without a session, so a new controller cannot silently opt out of the global
  guard.

Beyond the suite, each layer was verified against a live Supabase project with
two real users, since what matters most is what one user cannot do to another:
cross-user reads, updates, deletes and retrieval all return nothing.

## What I would do with more time

**Indexing should be a queue, not part of the write.** Embedding currently runs
inside the create/update request. It is bounded by a content length cap and
recorded honestly when it fails, but a long document makes for a slow save. The
right shape is a job table plus a worker, with the existing `indexed_at` /
`indexing_error` columns becoming the job state they already resemble.

**Retrieval quality has obvious next steps.** Hybrid search — combining the
vector index with Postgres full-text — would fix the case vector search is worst
at: exact identifiers, error codes, names. After that, a reranking pass over the
top ~30 candidates, and query rewriting through the chat model so follow-ups
resolve properly instead of relying on the current concatenation heuristic.

**RLS deserves pgTAP tests in CI.** I verified the policies by exercising them
as two users against a real database, but that was a one-off script rather than
something that runs on every push. `supabase test db` with pgTAP would make the
isolation guarantees regression-proof, which matters because RLS failures are
silent.

**Pagination is offset-based.** Fine for the document counts this app produces,
wrong in principle. Keyset pagination on `(updated_at, id)` needs an index
change and a cursor in the contract.

**File upload.** The document model is already text plus metadata, so PDF and
TXT extraction would feed the same pipeline — this is additive rather than
structural, which is why it was the first stretch goal to cut.

**A usage view.** Every assistant message already records its model and token
counts, so a per-user cost breakdown is a query and a page, not new plumbing.

**Smaller things:** activating the dark theme that the palette already defines;
optimistic UI on document save; cancelling an in-flight
answer (the `AbortSignal` is already plumbed through the AI layer but nothing
triggers it); a document picker in the chat composer, since the API already
accepts `documentIds` to scope retrieval; and a rate limiter in front of the
chat endpoint.

## Known limitations

- Conversations are not titled by the model — the first question is truncated
  into a title. Cheap and predictable, occasionally clumsy.
- The chat model must actually be available. Free-tier models on aggregators are
  frequently rate-limited upstream, which surfaces correctly as a 429 but makes
  for a poor demo.
- Answers render as prose with citation markers picked out, not as Markdown.
  The prompt asks for prose, so this is consistent, but a model that ignores it
  will show raw syntax.
- The palette defines a full dark theme, but nothing activates it: the variant
  is gated on a `.dark` class that no code adds, so the app is light-only in
  practice. Wiring it to `prefers-color-scheme` or a toggle is a small change
  that I did not want to make late.
