# Agentic Employees v1.3 — Event-Driven Workforce

Agentic Employees v1.3 adds durable, bounded reactions to verified Ledgerly events. Employees may analyze and recommend follow-up, but event reactions never send messages, alter balances, approve leave, change academic records, or mutate stock by themselves.

## Event routing

- Posted school-fee payment allocation → Grace (Bursar)
- Student absence → Amina (Secretary); repeated urgent absence also escalates to Mirembe (Head Teacher)
- Approved staff leave → Sarah (HR)
- Writing-book stock crossing the configured threshold → Peter (Librarian)
- Overdue lesson plan → Daniel (DOS)

Unacknowledged attention/urgent reactions from the previous 48 hours are included in Mirembe's daily Head Teacher brief.

## Durability and safety

`ae_event_inbox` stores source events before employee processing. Processing claims are recoverable after ten minutes, failures retry up to three times with incremental backoff, and `(organization,event,agent)` uniqueness prevents duplicate employee reactions.

When OpenAI is unavailable, Ledgerly stores a deterministic factual fallback reaction instead of losing the event. Every reaction remains read-only. Any communication or sensitive operational action continues through the existing human approval/execution workflow.

## Configuration

The Event Reactions screen allows schools to enable or disable the full event workforce or individual Finance, Attendance, HR and Books streams. Schools can also configure the rolling absence window, attention/urgent absence counts, and books low-stock threshold.

## Database migrations

Apply after `0101_agentic_employee_family_reports.sql`:

- `0102_agentic_employee_events.sql`
- `0103_agentic_employee_event_settings.sql`
- `0104_agentic_event_source_hardening.sql`

The current implementation uses D1/SQLite triggers for mutation-backed source events plus the existing scheduled module hook for time-derived events such as overdue lesson plans. During the PostgreSQL self-hosted cutover, these source emissions should move through the corresponding runtime/domain-event abstraction while preserving the `ae_event_inbox` contract.

## Validation commands

```bash
npm run modules:sync
npm run typecheck
npm test
npm run build:web
```
