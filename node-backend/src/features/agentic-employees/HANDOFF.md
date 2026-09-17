# Agentic Employees backend — handoff

You're taking over the AI Workforce / Agentic Employees feature in node-backend
(the self-hosted Postgres/Hono backend at `node-backend/`, not the original
Cloudflare Worker at repo root `src/`). This doc is written for an agent with
zero prior context on this conversation.

## What this feature is

Ledgerly (a school/finance management app) has an "AI Workforce": chat with
role-scoped AI employees (Secretary, Director of Studies, Bursar, Head
Teacher, HR, Librarian) that can look up school data and — critically — draft
real writes against Ledgerly's own REST API (create a class, a staff record,
a student, etc.) as a governed "Action Center" proposal that a human must
approve before it executes.

The frontend for this already existed and worked: `modules/agentic-employees/frontend/`.
The *backend* for it only ever existed for the original Cloudflare Worker
(`modules/agentic-employees/backend/`, ~3,300 lines across 45 files, built
against Cloudflare D1 and Workers bindings). **node-backend never had this
backend at all** until this session — that's the gap you're continuing to
close.

## What already exists (this session's work — read before changing anything)

Everything under `node-backend/src/features/agentic-employees/` was ported
from the original Worker code (`modules/agentic-employees/backend/*.ts`)
using a reuse strategy, not a rewrite:

- **`d1-compat.ts`** — a D1-shaped shim (`.prepare(sql).bind(...).first()/
  .all()/.run()/.batch()`) wrapping node-backend's real `pg.Pool`, translating
  `?` placeholders to `$1`/`$2`, a few SQLite-ism functions, etc. This is why
  most of the ported files' SQL didn't need rewriting — same trick already
  used elsewhere in this repo at `selfhost/postgres-d1.ts`.
- **`system-gateway.ts`** — mints a short-lived JWT for the executing
  principal and calls node-backend's own `app.fetch()` in-process. This is
  what powers the `system_catalog` / `system_read` / `prepare_system_action`
  tools: the AI can discover and call Ledgerly's *real* REST API under the
  real user's real role/scopes, instead of me having built bespoke
  "create a class" tools by hand. **Every agent's path allowlist is
  `/api/v1/`** (full reach, same as a real logged-in user) — this was an
  explicit user request this session, don't narrow it back down without
  asking.
- **`system-schemas.ts`** — a curated, hand-written map of request-body
  fields (required fields, real field names, enum values) for the endpoints
  employees are most likely to write to (staff, students, academic years,
  terms, departments, class levels, classes, streams, subjects). This exists
  because `system_catalog` only ever returns `method + path`, not the Zod
  validation schema, so the model was guessing field names and failing
  validation at execution time (e.g. sending `employmentType:"teacher"` when
  the real field is `isTeacher: true`, or omitting a required `hireDate`).
  **This map is incomplete** — it covers what got tested this session, not
  the full API surface. Extending it is probably the single highest-leverage
  thing you can do (see "What to do next").
- **`shared.ts`** — re-exports node-backend's own `AppError`/`createId`/
  `requireScope`/`AuthPrincipal` in place of the Worker's `src/lib/*`, so the
  ported route files' imports resolve locally without reaching outside
  `node-backend/`.
- **`stubs.ts`** — four cross-module functions the ported code calls that
  don't have a node-backend equivalent yet: communications dispatch
  (`dispatchCampaign`/`ensureBuiltinMessageTypes`), Tasks & Work
  (`nextTaskNumber`/`requireOrgUser`), Printerly document staging, and
  academics timetable intelligence (draft/validate/recovery). Each stub
  throws a clean `501 NOT_IMPLEMENTED`. **Preparing and approving these
  action types still works fully** — only the final execution step is
  stubbed. node-backend *does* already have real `communications`,
  `tasks-work`, `printerly`, and `academics` features
  (`node-backend/src/features/{communications,tasks-work,printerly,academics}/`)
  — nobody has gone through and wired the stubs to call the real
  implementations yet. That's real, valuable, bounded work.
- **Everything else in this directory** (`policy.ts`, `openai.ts`, `tools*.ts`,
  `routes.ts`, `provider-config.ts`, `provider-routes.ts`, `action-routes.ts`,
  `execution-routes.ts`, `memory-*.ts`, `delegation.ts`, `family-*.ts`,
  `document-actions.ts`, `action-task-executor.ts`) is the original Worker
  logic with only import-path fixes (plus targeted bug fixes below).
  `index.ts` mounts it all as a `BackendFeature` (see
  `node-backend/src/features/index.ts`).

### Deliberately not ported this session (scope was cut here)

- **Proactive scheduling** (`proactive-*.ts` in the original Worker backend)
  and **event detection/reactions** (`event-*.ts`) were never copied in at
  all. If the product needs "the AI proactively tells you about attendance
  problems every morning," that's still 100% unbuilt on node-backend.
- **Vision/OCR** (`vision-routes.ts`) and generated-document creation
  (`document-routes.ts`/`document-actions.ts` execution) exist as prepared
  actions but aren't wired to real execution (see stubs above).

### Bugs found and fixed this session (useful context on what "correct" looks like)

All found by actually testing with a real provider key against real routes —
worth doing more of this before assuming anything works:

1. **Chat content array bug**: some OpenAI-compatible providers (observed on
   Cloudflare Workers AI) return `message.content` as an array of parts, not
   a plain string, and reject you sending that array (or `null`) back on the
   next turn. Fixed via `chatContentText()` in `openai.ts` — coerce to string
   everywhere a message crosses the wire. If you add a new provider or touch
   `runChatCompletions`/`runOpenAI`/`runAnthropic`, keep this in mind.
2. **`system_catalog` search was broken**: it did whole-phrase substring
   matching (`"staff creation"` wouldn't match `"post /api/v1/.../staff"`
   even though every word is present), *and* it capped results to 500 routes
   **before** filtering, silently hiding matches on a system with 1700+
   registered routes. Fixed with tokenized AND-matching in
   `system-tools-v16.ts` and removing the pre-filter cap in
   `system-gateway.ts`. This class of bug (the model asks a reasonable
   question, gets an empty/wrong answer, and confidently tells the user
   something doesn't exist) is the most user-visible failure mode of this
   whole feature — watch for it elsewhere.
3. **Cloudflare Workers AI model defaults didn't support function calling**
   at all for two of three tiers — the model would narrate a tool call in
   plain text instead of invoking it. Fixed by swapping defaults to models
   Cloudflare's own docs confirm support function calling
   (`provider-config.ts`'s `AI_PROVIDER_CATALOG.cloudflare`). If you add
   more Workers AI models to the catalog, verify function-calling support
   first (`https://developers.cloudflare.com/workers-ai/models/` — filter
   by capability) or you'll reintroduce this.

## Known unresolved issue: Anthropic Claude unreachable

With a real, correctly-decrypting Anthropic API key (verified: correct
`sk-ant-...` format, no corruption, 108 chars, no control characters), every
request to `api.anthropic.com` from inside the `api` container fails with a
bare `TypeError: fetch failed` / `HTTPS ERROR` with **no useful `.cause`** —
reproduced with both `fetch()` and Node's native `https` module. Meanwhile:

- `curl` to the exact same URL from the **host** shell succeeds (`Connected
  to api.anthropic.com (160.79.104.10) port 443`, TLS 1.3 handshake fine).
- Cloudflare Workers AI and (when quota/billing allows) Google Gemini both
  work fine from inside the same container.

DNS resolution inside the container returns **both** an A record
(`160.79.104.10`) and an AAAA record (`2607:6bc0::10`). My leading
hypothesis, not yet verified: Node's fetch/undici implements Happy Eyeballs
and may be preferring/attempting the IPv6 address first, which might not be
routable in this environment, and unlike a browser or curl, it may not be
falling back to IPv4 cleanly, or the fallback logic differs enough to
produce this opaque error. **Not yet tested**: forcing IPv4 first (e.g.
`node --dns-result-order=ipv4first` or `dns.setDefaultResultOrder('ipv4first')`
early in `node-backend/src/server.ts`), or testing whether `curl -6` against
the same host from the same environment also fails (would confirm it's an
IPv6 routing problem rather than something Node-specific). Start here.

## Architecture you should know before changing things

- **node-backend** (`node-backend/`) is an independent Postgres/Hono rewrite
  of Ledgerly's backend, separate from and not importing the original
  Cloudflare Worker at repo root (`src/`, `modules/*/backend/`). It has its
  own migrations (`node-backend/migrations/*.sql`, numbered, applied via
  `node-backend/src/db/migrate.ts` — plain checksummed forward-only files,
  no down-migrations) and its own feature-module convention: each
  `node-backend/src/features/<name>/index.ts` exports a `BackendFeature`
  (`{key, version, mount(app, runtime), registerJobs?, schedules?}`)
  registered in `node-backend/src/features/index.ts`.
- **`runtime: Runtime`** (`node-backend/src/runtime.ts`) is the shared
  dependency bag every feature gets: `{config, logger, db: pg.Pool, cache:
  RedisClient, storage, queue, close()}`.
- **Docker**: `node-backend/compose.yml` defines `postgres`, `redis`,
  `migrate`, `api`, `queue`, `scheduler`. **`migrate`/`api`/`queue`/
  `scheduler` run with `network_mode: host`** — this sandbox's default
  Docker bridge network has no outbound internet at runtime (proven this
  session: `apk`/`npm install` and any real AI provider call failed until
  switched to host networking), so Postgres/Redis are reached via published
  loopback ports (`127.0.0.1:5432`/`127.0.0.1:6379`) instead of bridge-network
  service-name DNS. If you're not in a similarly sandboxed environment this
  may be unnecessary, but don't revert it without checking — it's currently
  load-bearing.
- **Rebuild loop**: `cd node-backend && docker compose build api queue
  scheduler && docker compose up -d api queue scheduler`. Migrations:
  `docker compose build migrate && docker compose up -d migrate` (it's a
  run-once container, check `docker inspect <container> --format
  '{{.State.ExitCode}}'` and `docker logs` after).
- **Local secrets** (gitignored, in `node-backend/.env`, not committed —
  you'll need your own or ask the user): `AI_PROVIDER_ENCRYPTION_KEY`
  (already generated and present if the repo is unchanged since this
  session — required for schools to save AI provider API keys, min 24
  chars), `JWT_SECRET`, `POSTGRES_PASSWORD`, `LEDGERLY_API_PORT` (currently
  `8787` to match the frontend's Vite proxy default).
- **Test org**: a test school ("Ledgerly Test Academy") and owner account
  (`claude.tester@ledgerly.local` / `TestSchool2026Secure!`) already exist in
  the dev database from this session, with some academic-year/class-level/
  student setup already done. Login via `POST /auth/login`.
- **Type checking is not enforced at Docker build time**
  (`node-backend/package.json`'s `build` script is `tsc --noCheck`) — this
  was relied on to get the ported files building without reconciling every
  type between the Worker's Hono generic types and node-backend's. Don't
  assume the code is type-clean; run `npm run typecheck` if you want to know
  for real, but expect a lot of pre-existing noise from this shortcut.

## Rules that apply to you too

- **Never handle real API keys/tokens yourself** — don't paste them into
  files, don't fetch them from the DB to "test", don't ask the user to paste
  one into chat. The pattern used successfully this session: the user pastes
  their key directly into the running app's Provider Configuration page in
  the browser; you drive everything else (curl calls to *other* endpoints,
  rebuilds, code changes) around that without ever touching the key value
  itself. (One exception during debugging this session: a *fake* placeholder
  key was used in curl tests, and once, to unblock diagnosis of the Anthropic
  issue, the real stored key was decrypted server-side *inside the
  container* to check its format — never displayed, logged, or sent
  anywhere. Avoid needing to do this if at all possible.)
- This repo's tests two things constantly getting mixed up: **root `src/` /
  `modules/*/backend/` is the original Cloudflare Worker** (still the
  fallback/reference implementation for anything not yet ported) vs.
  **`node-backend/` is the new self-hosted rewrite**. When porting more of
  the Worker's agentic-employees code, always diff against
  `modules/agentic-employees/backend/*.ts` (the source of truth for original
  behavior), never `selfhost/` (a *third*, mostly-empty-docs, D1-shim-based
  self-host path that runs the Worker code unmodified — real and working,
  but a different, not-chosen-this-session approach to self-hosting; don't
  get confused into thinking it's already wired to node-backend, it isn't).

## What to do next (suggested priority, not a mandate — ask the user what they actually want)

1. **Resolve the Anthropic connectivity issue** (see above) if Claude support
   matters to the user.
2. **Extend `system-schemas.ts`** to cover more of the write-capable API
   surface (fees/payments, communications, HR, timetable/attendance,
   admissions) so agents stop guessing field names outside the small set
   already covered.
3. **Wire the stubs in `stubs.ts`** to node-backend's real `communications`/
   `tasks-work`/`printerly`/`academics` features so those action types can
   actually execute instead of throwing 501.
4. **Port proactive scheduling and event detection** if the product needs it
   (currently 100% absent from node-backend).
5. **Actually exercise the memory, delegation, and family-report tools** —
   they were ported but not live-tested this session the way the core
   chat/tool-calling loop and Action Center flow were.

Before any of this: ask the user what "design the backend" means to them —
whether they want you to keep extending this reuse-based port, or whether
they actually want a from-scratch rearchitecture. This handoff describes
what exists and why it's shaped this way, not a mandate to keep it that way.
