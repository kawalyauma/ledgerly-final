# Agentic Employees v1.2 — Proactive Workforce

Agentic Employees v1.2 adds scheduled, read-only reviews for school operations. Proactive runs never receive write-capable Ledgerly tools and never send communications automatically.

## Default workflows

- DOS daily academic review — 06:30 school time
- Bursar daily collections review — 07:00 school time
- HR daily workforce review — 07:15 school time
- Secretary daily front-office review — 07:30 school time
- Librarian weekly books review — Monday 07:20 school time
- Head Teacher daily management brief — 07:45 school time

The Head Teacher brief reuses recent specialist reports when available. If a specialist report is missing, Ledgerly runs that read-only specialist review first and then synthesizes the management brief.

## Security

Only organization owners/admins can initialize, change, or manually run proactive schedules. Each schedule records the admin user who owns it. Scheduled execution only runs while that user remains an active owner/admin. A later owner/admin can take ownership by using **Ensure defaults** or editing a schedule.

Proactive data collection is organization-scoped and read-only. The scheduled model receives prepared Ledgerly context rather than unrestricted database access. Sensitive outbound actions still use the separate approval and execution workflow from v1.1.

## API

Base path: `/api/v1/agentic-employees`

- `GET /proactive/schedules`
- `POST /proactive/initialize`
- `PATCH /proactive/schedules/:id`
- `POST /proactive/run/:workflowKey`
- `GET /proactive/runs`

## Database

Apply `migrations/0100_agentic_employees_proactive.sql` after `0099_agentic_employees.sql`.

It adds:

- `ae_proactive_schedules`
- `ae_proactive_runs`

## Runtime

The module uses Ledgerly's existing scheduled-module hook. The current Worker configuration already has recurring cron triggers, so no extra cron entry is required for v1.2.

After applying migrations:

```bash
npm run modules:sync
npm run typecheck
npm test
npm run build:web
```
