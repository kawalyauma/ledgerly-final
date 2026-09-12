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

### Banking / Reconciliation
- bank accounts linked to Finance Core ledger accounts
- structured bank statement imports with exact-import and external-transaction deduplication
- unmatched, matched and reconciled bank transaction states
- safe matching only to posted journal lines on the correct bank ledger account, signed amount and currency
- reconciliation previews with ledger balance, imported-statement balance and matched/unmatched counts
- completed reconciliation snapshots with immutable reconciled transactions
- bank charges and same-currency bank transfers through the journal engine
- fiscal-period-aware bank charge and transfer posting

### Budgets / Forecasting
- annual, departmental, cash-flow and rolling-forecast budget types
- draft, submitted, approved, rejected, active and archived workflow
- versioned revisions, scenarios, locking and activation
- none/warning/block enforcement policy with spend-check API
- hierarchical cost centers and revenue sources linked to revenue accounts
- monthly budget lines with project/class/department/location dimensions
- automatic actual refresh from posted ledger journals and hourly durable refresh jobs
- budget-vs-actual variance, favorable/unfavorable analysis and variance notes
- manual, actuals-plus-plan, run-rate and percentage forecasts
- forecast approval/archive lifecycle and forecast-vs-actual variance
- Budget vs Actual report and queued exports are now enabled

### Financial Reports
- Trial Balance, Profit & Loss, Balance Sheet and Cash Flow
- General Ledger, transaction detail and account activity
- Accounts Receivable and Accounts Payable aging with aging buckets
- customer and supplier statements
- sales, expense, project, tax, payroll-ledger, equity and retained-earnings reports
- bank reconciliation, bank transactions, cash/bank and reconciliation summaries
- document, payment, journal, contact-balance and fiscal-period summaries
- comparative statements, financial ratios, draft-transaction and finance audit reports
- Budget vs Actual backed by the migrated budgeting engine
- queued JSON, CSV, XLSX and PDF exports using the self-hosted durable queue and object storage
- report catalog still marks reports that depend on unmigrated Inventory, Fixed Assets or multi-entity consolidation as unavailable instead of returning misleading data

Current migrated finance paths include `/api/v1/accounts`, `/api/v1/journals`, `/api/v1/fiscal-years`, `/api/v1/periods`, `/api/v1/contacts`, `/api/v1/documents`, `/api/v1/payments`, `/api/v1/banking`, `/api/v1/budgets` and `/api/v1/reports`. Features not yet migrated remain unavailable from the Node backend until their own migration is completed.

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
