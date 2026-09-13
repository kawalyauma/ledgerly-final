# Ledgerly Agentic Employees

`modules/agentic-employees` adds tenant-scoped AI employees to Ledgerly. The initial employees are Secretary, Director of Studies, Bursar, Head Teacher Assistant, HR Officer and Librarian.

## Provider configuration

The module uses the OpenAI Responses API through plain `fetch`, so it adds no OpenAI SDK dependency. Configure the backend runtime with:

```bash
OPENAI_API_KEY=...
# optional overrides
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL_LUNA=gpt-5.6-luna
OPENAI_MODEL_TERRA=gpt-5.6-terra
OPENAI_MODEL_SOL=gpt-5.6-sol
```

Never put `OPENAI_API_KEY` in frontend environment variables, organization settings, D1 rows or source control.

## Security model

The model never receives SQL access or a database binding. It only receives JSON-schema tools selected from the employee's compiled allowlist. Every tool execution injects `principal.organizationId` server-side; the LLM cannot choose another tenant. Tenant configuration can remove tools from an employee but cannot add tools outside the compiled employee allowlist.

Read tools also enforce the user's Ledgerly scopes. Sensitive action tools create an `ae_approvals` record instead of executing the action. Approval checks the human reviewer's permission again.

The first release intentionally does **not** auto-send an approved communication. An approved record means that a human authorized the proposed action; a communications executor should consume approved actions in a follow-up integration. This prevents an AI tool response from being mistaken for a successfully sent message.

Every model tool call is persisted in `ae_tool_calls`, and conversations, messages, tasks and approvals are tenant-scoped.

## Initial employees

- **AI Secretary (Amina)** — front-office lookup, school summaries, communication drafts.
- **AI Director of Studies (Daniel)** — academic supervision and management analysis.
- **AI Bursar (Grace)** — fee balance lookup, arrears summaries, collection-message drafts.
- **AI Head Teacher Assistant (Mirembe)** — cross-functional management reasoning and investigations.
- **AI HR Officer (Sarah)** — workforce lookup and controlled staff communication drafting.
- **AI Librarian (Peter)** — learner lookup and library-work assistant; it is explicitly instructed not to invent circulation data until library tools are exposed.

## Model routing

- Luna: routine/high-volume work — Secretary, HR, Librarian.
- Terra: balanced reasoning — DOS, Bursar.
- Sol: complex management reasoning — Head Teacher Assistant.

Schools can change an employee's tier. Server operators can remap each tier to another model ID with environment variables.

## API

Base path: `/api/v1/agentic-employees`

- `GET /agents`
- `PATCH /agents/:key`
- `GET|POST /conversations`
- `GET|POST /conversations/:id/messages`
- `GET|POST /tasks`
- `GET /approvals`
- `POST /approvals/:id/approve`
- `POST /approvals/:id/reject`
- `GET /activity`
- `GET /settings`

## Database

Apply `migrations/0099_agentic_employees.sql`. It creates:

- `ae_agent_settings`
- `ae_conversations`
- `ae_messages`
- `ae_tasks`
- `ae_tool_calls`
- `ae_approvals`

## Deployment

After configuring `OPENAI_API_KEY` and applying the migration, use Ledgerly's normal workflow:

```bash
npm run modules:sync
npm run typecheck
npm test
npm run build:web
```

The module registry is generated automatically by `modules:sync`; no application-shell import should be added manually.
