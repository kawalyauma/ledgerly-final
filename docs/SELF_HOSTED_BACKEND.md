# Ledgerly self-hosted backend

This runtime keeps the existing Hono application, route paths, authentication middleware, and generated `modules/*/backend/` registry. Cloudflare remains usable as a fallback through `wrangler`; the self-hosted processes inject compatible bindings into the same Worker export.

## Runtime mapping

| Cloudflare binding/runtime | Self-hosted replacement |
| --- | --- |
| Worker `fetch` | Node.js HTTP server in `src/node/server.ts` |
| D1 `FINANCE_DB` | PostgreSQL via `PostgresD1Database` compatibility adapter |
| R2 buckets | local durable filesystem via `LocalR2Bucket` |
| Queues | `selfhost_jobs` PostgreSQL durable queue table + `start:queue` worker |
| Cron triggers | `start:scheduler` process with durable run claims in PostgreSQL |
| Worker vars/secrets | validated process environment in `src/node/config.ts` |

The compatibility adapter deliberately preserves the existing D1-style `prepare().bind().first()/all()/run()` contract so core routes and module backends can move incrementally instead of changing their API behavior at the same time as the infrastructure migration.

## Prerequisites

- Node.js 20 or newer
- PostgreSQL 15+ (17 recommended)
- a dedicated Linux user such as `ledgerly`
- persistent storage, e.g. `/var/lib/ledgerly/storage`

## Install and initialize

```bash
cd /opt/ledgerly
npm install
sudo install -d -o ledgerly -g ledgerly /var/lib/ledgerly/storage /etc/ledgerly
sudo cp .env.selfhost.example /etc/ledgerly/ledgerly.env
sudo chown root:ledgerly /etc/ledgerly/ledgerly.env
sudo chmod 0640 /etc/ledgerly/ledgerly.env
set -a; . /etc/ledgerly/ledgerly.env; set +a
npm run db:migrate:selfhost
```

`migrations-postgres/0001_selfhost_runtime.sql` creates the durable queue/scheduler infrastructure and the SQLite `datetime(..., modifier)` compatibility helper. The application business schema still needs to be migrated from the existing D1 migrations before production traffic is cut over; do not point a production client at an empty PostgreSQL database just because the runtime health check passes.

## Run manually

Use three processes so HTTP request latency is isolated from background work:

```bash
npm run start:server
npm run start:queue
npm run start:scheduler
```

The API remains on the same Hono routes. Readiness is available at:

```bash
curl -fsS http://127.0.0.1:8787/system/health
curl -fsS http://127.0.0.1:8787/
```

`/system/health` executes `SELECT 1` through the PostgreSQL D1 adapter, so it verifies both HTTP and database connectivity.

## systemd

Copy the units from `deploy/systemd/` to `/etc/systemd/system/`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ledgerly-api ledgerly-queue ledgerly-scheduler
sudo systemctl status ledgerly-api ledgerly-queue ledgerly-scheduler
```

The supplied units run as `ledgerly`, load `/etc/ledgerly/ledgerly.env`, restart automatically, and only grant write access to `/var/lib/ledgerly`.

## PostgreSQL/D1 compatibility notes

The adapter currently converts positional `?` parameters to PostgreSQL `$1..$n`, maps the common SQLite `datetime('now', modifier)` and `datetime(CURRENT_TIMESTAMP, modifier)` forms, maps `IFNULL` to `COALESCE`, and preserves `INSERT OR IGNORE` with `ON CONFLICT DO NOTHING`. PostgreSQL constraint errors are normalized to the strings already recognized by the existing API error mapper.

This is the infrastructure seam, not the end of SQL migration. Before production cutover, audit every query in `src/` and `modules/*/backend/` for SQLite-only SQL such as `strftime`, `json_extract`, `GROUP_CONCAT`, `INSERT OR REPLACE`, SQLite affinity assumptions, or D1 migration syntax, and either translate it in the compatibility layer or migrate the query explicitly.

## Storage

`REPORTS_BUCKET` maps to `${STORAGE_ROOT}/reports` and `WORK_FILES_BUCKET` maps to `${STORAGE_ROOT}/work-files`. Object keys are path-traversal checked and metadata is stored under each bucket's `.metadata` directory. Keep `STORAGE_ROOT` on persistent storage and include it in backups.

A future MinIO/S3 implementation can replace `LocalR2Bucket` without touching route code because callers still see the R2-compatible binding.

## Durable queues

Queue producers write JSON payloads to `selfhost_jobs`. The queue worker leases rows with `FOR UPDATE SKIP LOCKED`, increments attempts, honors `ack()`/`retry()` semantics, uses delayed exponential retry, and moves exhausted jobs to `dead`. This makes restarts safe and avoids in-memory job loss.

## Scheduler

The scheduler reproduces the Worker trigger set in `wrangler.jsonc`: every minute, every 5 minutes, hourly, and daily at 05:00 UTC. `selfhost_scheduled_runs` uses `(cron, run_key)` as a durable claim, so a restart does not intentionally execute the same minute twice.

## Cloudflare fallback

No Worker entrypoint, route, or module registry was removed. Existing commands remain:

```bash
npm run dev:worker
npm run deploy
npm run db:migrate:remote
```

Keep Cloudflare available until the PostgreSQL business schema/data migration and module SQL audit are complete and production smoke tests pass against the self-hosted server.
