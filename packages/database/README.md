# @repo/database

The Supabase schema, owned by the workspace rather than by either app. Both
`apps/api` (which queries it) and `apps/web` (which authenticates against it)
depend on the same migrations, so they live in a package instead of inside one
app's tree.

Turborepo's role here is deliberately small. Migrations are side-effecting and
talk to a remote project, so they are not cacheable tasks — `db:push` and
friends are pass-through scripts. What Turborepo _does_ own is
`src/database.types.ts`: it is generated from the live schema, committed, and
consumed by `apps/api`, so a schema change propagates as an ordinary type
error rather than a runtime surprise.

## Commands

Run from the repo root:

| Command               | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `pnpm db:link`        | Links this checkout to a Supabase project (once per clone) |
| `pnpm db:push`        | Applies pending migrations to the linked project           |
| `pnpm db:new <name>`  | Creates an empty migration file                            |
| `pnpm db:diff <name>` | Captures dashboard changes as a migration                  |
| `pnpm db:types`       | Regenerates `src/database.types.ts` from the live schema   |
| `pnpm db:status`      | Shows which migrations are applied                         |
| `pnpm db:advisors`    | Runs Supabase's security and performance advisors          |

## Migration strategy

Imperative, forward-only, one file per change, committed in order. No
migration is edited once pushed; a correction is a new migration. The schema
is therefore reproducible from an empty project by `pnpm db:push` alone, which
is what makes a fresh clone runnable.
