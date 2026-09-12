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

### Fiscal Periods / Closing
- financial years and accounting periods
- open, closed and locked states
- journal posting and reversal protection at both service and PostgreSQL levels

### Contacts
- customer and supplier master data
- addresses and contact people
- archive, restore and merge workflows
- financial-history-safe deletion

### Documents
- invoices, bills, credit notes and supplier credits
- document lines, tax amounts and totals
- automatic Accounts Receivable / Accounts Payable control-account selection
- automatic balanced journal posting
- fiscal-period-aware reversals

### Payments / Allocations
- customer receipts and supplier payments
- partial and multi-document allocations
- unallocated payment balances
- invoice/bill outstanding-balance reporting
- automatic document `open` / `partially_paid` / `paid` state synchronization
- receipt posting: debit cash/bank, credit Accounts Receivable
- supplier-payment posting: debit Accounts Payable, credit cash/bank
- allocation and over-allocation enforcement in PostgreSQL
- payment reversal with automatic allocation rollback and document balance restoration
- fiscal-period-aware posting and reversal

Current migrated finance paths include `/api/v1/accounts`, `/api/v1/journals`, `/api/v1/fiscal-years`, `/api/v1/periods`, `/api/v1/contacts`, `/api/v1/documents` and `/api/v1/payments`. Features not yet migrated remain unavailable from the Node backend until their own migration is completed.

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
