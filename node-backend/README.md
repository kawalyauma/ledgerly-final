# Ledgerly Node Backend

This directory is the independent self-hosted Ledgerly backend. It never imports the Cloudflare Worker backend; the repository root remains the Cloudflare fallback during migration.

## Migrated features

### Core Identity / Organizations
- registration, login, refresh and logout
- JWT and API-key authentication
- memberships, scopes and tenant switching
- organization settings
- MFA-compatible identity storage and login audit

### Finance Core
- PostgreSQL Chart of Accounts and account groups
- the same 11 default accounts currently provisioned by Ledgerly registration
- automatic/lazy provisioning for newly created and existing organizations
- durable scheduled provisioning job consuming `organization.created` events without coupling Identity to Finance
- journal creation with balanced-line validation and PostgreSQL-safe entry sequencing
- idempotent journal creation via `Idempotency-Key`
- posting, listing, detail, draft deletion and safe manual/opening-balance reversal
- opening balances through the journal engine

Current finance paths are `/api/v1/accounts` and `/api/v1/journals`. Features not yet migrated remain unavailable from the Node backend until their own migration is completed.

## Local start

```bash
cd node-backend
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Run background services separately:

```bash
npm run dev:queue
npm run dev:scheduler
```

## Production

```bash
npm install
npm run check
npm run db:migrate
npm run build
```

Docker Compose starts PostgreSQL, Redis, MinIO, applies migrations, then runs API, queue worker and scheduler. Host-native deployments can use the systemd units in `deploy/systemd/`.

Every future feature belongs under `src/features/<feature>/` with PostgreSQL migrations, contract tests, jobs/schedules where required, and a registry entry in `src/features/index.ts`.
