# Ledgerly Node Backend

This directory is a **new, independent backend** for Ledgerly. It is not a wrapper around `src/`, does not import Cloudflare Worker routes, and does not use D1, R2, Cloudflare Queues, or Worker cron bindings.

The existing repository root remains the Cloudflare backend/fallback. Feature parity will be implemented inside this directory one feature at a time while preserving the public API contracts used by the existing web and mobile clients.

## Foundation delivered

- Hono HTTP API running on Node.js 22 via `@hono/node-server`
- PostgreSQL connection pool and migration runner
- Redis connection for cache/locks/session acceleration
- durable PostgreSQL-backed background queue using `FOR UPDATE SKIP LOCKED`
- standalone queue worker process
- standalone scheduler process; schedules enqueue durable jobs and use PostgreSQL advisory locks
- pluggable object storage: local filesystem or MinIO/S3-compatible storage
- validated environment configuration
- JSON structured logging
- liveness and dependency health endpoints
- graceful API shutdown
- Docker/Compose foundation
- systemd service definitions for API, queue worker and scheduler
- feature registry deliberately empty until feature-by-feature migration begins

## Boundary

```text
repository root/          Cloudflare backend (existing fallback)
node-backend/             New self-hosted backend
  src/features/           New feature implementations only
  migrations/             PostgreSQL migrations only
  src/server.ts           Node HTTP entrypoint
  src/queue/worker.ts     durable async worker
  src/scheduler/          recurring task runner
```

Do not import `../src` or `../modules/*/backend` into this project. Shared API behavior is reproduced deliberately inside `node-backend/src/features/*` as each feature is migrated.

## Local start

```bash
cd node-backend
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Start the worker and scheduler in separate terminals:

```bash
npm run dev:queue
npm run dev:scheduler
```

Foundation endpoints:

- `GET /` — backend identity and migrated feature list
- `GET /system/live` — process liveness, no dependency check
- `GET /system/health` — PostgreSQL, Redis and storage readiness

No business feature routes are present yet by design.

## Docker Compose

```bash
cd node-backend
export POSTGRES_PASSWORD='replace-me'
export MINIO_ROOT_PASSWORD='replace-me-too'
export JWT_SECRET='at-least-32-random-characters-change-this'
docker compose up -d --build
```

Compose starts PostgreSQL, Redis, MinIO, runs PostgreSQL migrations once, then starts the API, queue worker and scheduler.

## Production build

```bash
npm install
npm run check
npm run db:migrate
npm run build
```

For host-native deployment, copy the compiled project to `/opt/ledgerly/node-backend`, put secrets in `/etc/ledgerly/node-backend.env`, install the units from `deploy/systemd/`, then enable the API, queue and scheduler services.

## Feature migration rule

Each next migration should add a feature under `src/features/<feature>/`, its PostgreSQL migration(s), job handlers/schedules if needed, contract tests against the existing API shape, and then register that feature in `src/features/index.ts`.
