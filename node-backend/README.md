# Ledgerly Node Backend

This directory is a **new, independent backend** for Ledgerly. It does not import the Cloudflare Worker backend. The repository root remains the Cloudflare fallback while features are rebuilt here against PostgreSQL.

## Platform foundation

Node.js 22 + Hono, PostgreSQL, Redis, durable PostgreSQL jobs, scheduler, local/MinIO storage, validated environment configuration, health checks, JSON logging, Docker Compose and systemd services are already present.

## Migrated features

### Core Identity / Auth / Organizations / Tenants — v1.0.0

Implemented independently in `src/features/core-identity/` with PostgreSQL migration `migrations/0002_core_identity.sql`.

Public contracts now implemented:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /api/v1/organizations/`
- `GET /api/v1/organizations/current`
- `PUT /api/v1/organizations/current`
- `POST /api/v1/organizations/`
- `POST /api/v1/organizations/switch`
- `GET|POST /api/v1/admin/memberships`
- `PUT|DELETE /api/v1/admin/memberships/:userId`
- `GET|POST /api/v1/admin/api-keys`
- `DELETE /api/v1/admin/api-keys/:id`

Auth supports HS256 access JWTs, rotating 30-day refresh sessions, API keys, role/scope authorization, the development identity headers used by the old backend, username/phone aliases scoped by organization, and compatible TOTP/recovery-code verification. Passwords use the same `scrypt-v1` format as the current Ledgerly backend and can verify the legacy PBKDF2 format during transition.

Tenant creation intentionally does **not** create Finance accounts inside Identity. Instead it commits an `organization.created` event to `backend_outbox_events`. The Finance feature will consume/backfill that contract when Finance is migrated, keeping the new backend modular.

## Boundary

```text
repository root/          Cloudflare backend / fallback
node-backend/             Independent self-hosted backend
  src/features/           New feature implementations only
  migrations/             PostgreSQL migrations only
```

Never import `../src` or `../modules/*/backend` into this project.

## Run

```bash
cd node-backend
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Worker and scheduler run separately with `npm run dev:queue` and `npm run dev:scheduler`. Health endpoints are `GET /system/live` and `GET /system/health`.

For Docker deployment set `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, and `JWT_SECRET`, then run `docker compose up -d --build`.

## Feature migration rule

Each feature gets its own folder under `src/features/<feature>/`, PostgreSQL migration(s), jobs/schedules where needed, and contract tests. Cross-feature setup is coordinated through explicit events/outbox records rather than importing Cloudflare code or creating hidden coupling.
