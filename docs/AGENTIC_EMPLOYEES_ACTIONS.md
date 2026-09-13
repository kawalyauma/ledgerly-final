# Agentic Employees v1.4 — Action Center

Agentic Employees v1.4 turns verified AI observations into human-governed operational work. Employees may suggest and prepare actions, but they do not silently send communications or create operational Tasks & Work records.

## Lifecycle

`Suggested → Prepared → Awaiting approval → Approved → Executing → Executed`

Rejected or cancelled actions become `dismissed`. Execution failures become `failed` with the error retained for operators.

Every action has an organization-scoped idempotency key. Approved actions are atomically claimed as `executing` before external or operational work starts, preventing duplicate execution from double-clicks or concurrent requests.

## Event-to-action mappings

- Student absence → Amina can suggest a primary-guardian attendance SMS.
- Posted fee payment with a remaining balance → Grace can suggest a fee-balance follow-up SMS.
- Overdue lesson plan → Daniel can suggest a Tasks & Work follow-up, assigned to the teacher when the teacher user is known.
- Approved staff leave → Sarah can suggest a handover/coverage task.
- Low or exhausted writing-book stock → Peter can suggest a replenishment-review task.

The event processor stores these only as `suggested` Action Center items. It never executes them automatically.

## Conversation-prepared work

All six employees have the bounded `prepare_work_task` tool. A Director can tell Daniel, for example, to prepare a teacher follow-up task. The tool creates a suggested Action Center item only; it returns `executed: false` and requires the human lifecycle above.

## Execution and permissions

Communication execution reuses Ledgerly Communications and requires `communications:write` unless the principal is an owner/admin.

Task execution reuses Tasks & Work, requires `work:write` unless owner/admin, validates an optional assignee against active organization membership, obtains the canonical task number from `work_sequences`, and writes an audit log.

The existing generic AI Approvals screen remains compatible. Database triggers synchronize approval status back into `ae_actions`, and the legacy approval executor writes the resulting task/campaign link into the Action Center.

## Safety boundaries

v1.4 does not grant direct finance writes, receipt posting/reversal, leave approval, academic record editing, exam management, inventory mutation, or unapproved outbound messaging. Daniel's DOS boundary remains academic supervision; published result evidence may be read for approved reporting use cases but Daniel does not manage Exams.

## Migration

Apply after v1.3 migrations:

- `0105_agentic_employee_action_center.sql`

## Validation

Run the normal repository checks after module synchronization:

```bash
npm run modules:sync
npm run typecheck
npm test
npm run build:web
```
