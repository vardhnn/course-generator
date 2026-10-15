# Retro Course Studio

Describe what you want to learn — the studio researches the topic, writes the course (lessons,
diagrams, playgrounds, assessments) and grades you against its own lesson text. Next.js 16 (App
Router, Turbopack), Prisma + PostgreSQL, Tailwind v4, Vitest.

## Quick start

```bash
npm install
npm run dev        # boots an embedded PostgreSQL, applies migrations, starts Next
```

No database to install and no Docker: `npm run dev` starts a real PostgreSQL (data in
`prisma/pgdata`, gitignored) on `localhost:54329`, applies committed migrations, then runs the
dev server. Optional demo data in a second terminal:

```bash
npm run db:seed    # 3 demo courses + progress/attempts (mock provider when no keys are set)
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Embedded PostgreSQL (auto-start/attach) + `prisma migrate deploy` + dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run vercel-build` | What Vercel runs: `next build` (schema is applied out-of-band, see Deployment) |
| `npm test` | Vitest against its own disposable embedded PostgreSQL (port 54330) — never touches your dev data |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:local` | Run the embedded PostgreSQL alone (foreground) |
| `npm run db:migrate` | `prisma migrate deploy` (boots the local server if needed) |
| `npm run seed` | Seed demo courses (boots the local server if needed; skips when data exists) |
| `npm run db:import-sqlite <file.db>` | One-off import from a legacy SQLite database |
| `npx prisma migrate dev` | Create/apply migrations during development |

## Environment (`.env`)

Copy `.env.example` to `.env`. Local defaults need no edits — they match the embedded server.
What matters:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Local: the embedded URL from `.env.example`. Production: Neon **pooled** endpoint (contains `-pooler`) |
| `DIRECT_URL` | prod | Neon **unpooled** endpoint; Prisma uses it for migrations (`directUrl` in the schema) |
| `EXA_API_KEY` | no | Live web research for the research stage; falls back to deterministic sources |
| `AI_PROVIDER` | no | `auto` (default). The studio is BYOK: each account configures its provider at `/account/provider`; no server-side model keys are needed |
| `NEXT_PUBLIC_SITE_URL` | no | Site origin used in metadata and as the OpenRouter HTTP-Referer |
| `OLLAMA_NUM_CTX` | no | Context window for local Ollama (default 16384) |

## Identity model

- Accounts are email + password (Node scrypt, server-side opaque session tokens, 30-day cookie).
- **Courses, progress, assessments and certificates are per-account.** Course pages, the library,
  the quiz and the tutor all scope by the signed-in user; another account's course is a 404.
- Signing in (or signing up) on a device adopts anything created there before an account existed
  (`userId = NULL` rows), so nobody's local work is lost when identity starts to matter.
- Write endpoints (`/api/lessons/[id]/complete`, `/api/assessments/[id]/attempt`,
  `/api/courses/[id]`, `/api/generate`, `/api/certificates`) require a session.

## Deployment

### GitHub

The repository is deployment-ready as committed: `.gitignore` excludes `.env*` (only
`.env.example` is tracked), `prisma/pgdata`, `.next/`, logs and scratch files. No secrets live
in the tree.

```bash
git init && git add -A && git commit -m "Retro Course Studio"
git remote add origin <your-github-url> && git push -u origin main
```

### Vercel

The schema targets PostgreSQL (`provider = "postgresql"`), which is what Vercel serverless can
actually persist — the embedded/local file never ships.

1. Create a Supabase (or Neon) database and import the repo at vercel.com — the framework
   auto-detects Next.js; no `vercel.json` needed.
2. Set project environment variables: `DATABASE_URL` (pooled URL) and `DIRECT_URL` (migrations
   URL), plus optionally `EXA_API_KEY` and `NEXT_PUBLIC_SITE_URL` (the deployment URL).
   Note: Vercel build logs and error messages never print these values.

   For Supabase, both point at the **shared pooler**, never the direct host:

   - `DATABASE_URL` — transaction mode, port **6543**, `?pgbouncer=true`: `postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true`
   - `DIRECT_URL` — session mode, port **5432**: `postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`

   The direct host `db.<ref>.supabase.co` is IPv6-only on the free tier and Vercel is
   IPv4-only, so it is unreachable from a Vercel build or function. Both pooler endpoints are
   IPv4. Never use the direct host for either variable.
3. Apply the baseline migration to that database once, out-of-band — `npx prisma migrate deploy`
   from a machine that can reach it, or the Supabase/Neon dashboard SQL editor with
   `prisma/migrations/20261014_baseline/migration.sql`. The build deliberately does **not** run
   migrations: Vercel's build machine reaches Supabase's direct host only over IPv6, so a
   build-time `migrate deploy` cannot connect. Every page is `force-dynamic`, so `next build`
   never queries the database.
4. Deploy. The build runs `npm run vercel-build` (`next build`). `postinstall` runs
   `prisma generate`, so the client is built on Vercel too.
5. `export const maxDuration = 300` on `/api/generate` equals the Hobby plan maximum under Fluid
   Compute — valid on Hobby; at the limit Vercel kills the invocation with a 504, so generations
   that can exceed five minutes want Pro (800s).

### Production database notes

- **Supabase**: `DATABASE_URL` = transaction pooler (6543, `?pgbouncer=true`), `DIRECT_URL` =
  session pooler (5432). Both are IPv4; the direct host is IPv6-only and unreachable from
  Vercel. Apply migrations out-of-band (see Deployment) — the build does not run them.
- **Neon**: use the pooled endpoint in `DATABASE_URL` and the unpooled one in `DIRECT_URL`;
  Prisma's schema declares `directUrl` so migrations never go through the pooler.
- Local development and tests do not need Neon — they run against the embedded PostgreSQL.
- The legacy SQLite import (`npm run db:import-sqlite prisma/dev.db`) already moved existing
  data into the local PostgreSQL; it is a one-off and needs no database-specific tweaks
  (dates are converted from SQLite epoch-ms to `timestamptz`).

## Layout notes

- `src/app/**` — routes; per-page `metadata` titles branded by the root template.
- `src/lib/courses.ts` — every data read, scoped to the viewer.
- `src/lib/ai/**` — the seven-stage generation pipeline (research → blueprint → outline →
  lessons → playgrounds → assessments), providers, BYOK resolution.
- `scripts/local-db.mjs` — embedded PostgreSQL lifecycle (start/attach/create-db, UTF8 init).
- `scripts/dev.mjs`, `scripts/with-db.mjs` — env loading + DB-ensure wrappers behind
  `npm run dev` / `db:migrate` / `seed`.
- `src/test-global-setup.ts` — per-run disposable PostgreSQL for Vitest.
- `prisma/migrations/20261014_baseline` — single squashed baseline matching `schema.prisma`;
  `migrate deploy` reproduces the full schema on an empty database.
