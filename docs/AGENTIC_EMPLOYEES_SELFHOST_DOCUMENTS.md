# Agentic Employees v1.5 — PostgreSQL, Office documents and Printerly

Agentic Employees v1.5 adds a Node.js/PostgreSQL runtime for the AI workforce while preserving the existing Cloudflare Worker entrypoint as a fallback. It also gives all six employees a governed document workflow for DOCX, XLSX and PPTX output, persistent document storage, and Printerly printing.

## What runs on the Linux server

`selfhost/server.ts` serves the same Hono application used by the Worker. Its runtime bindings are replaced with self-hosted equivalents:

- D1-style database calls are backed by PostgreSQL through `selfhost/postgres-d1.ts`.
- `WORK_FILES_BUCKET` and `REPORTS_BUCKET` are backed by the local filesystem through an R2-compatible adapter. The storage directory can be placed on a dedicated volume and backed up independently.
- Worker Queue producers are backed by `selfhost_queue_jobs` in PostgreSQL.
- The Node process drains those jobs with `FOR UPDATE SKIP LOCKED` and calls the existing Ledgerly queue consumers, preserving communications, webhook, report and module queue behavior.
- Agentic Employees scheduled reviews/event processing run every minute in the Node process.
- OpenAI remains server-side and continues to use the same model routing and tool policy.

The Cloudflare `fetch`, `queue` and `scheduled` export in `src/index.ts` remains available. The Node runtime imports the same exported Hono `app` instead of creating a second API contract.

## PostgreSQL prerequisite

This v1.5 change migrates the Agentic Employees runtime and schema. It does **not** recreate every Ledgerly business table from D1. Before cutting a school to the Node runtime, the broader Ledgerly PostgreSQL migration must already contain the domain tables used by the employees (students, academics, fees, HR, books, Printerly, Tasks & Work, communications, etc.).

Apply the Agentic schema after those domain tables are present:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f selfhost/postgres/agentic-employees.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f selfhost/postgres/agentic-employees-v15.sql
```

The PostgreSQL schema uses native `pgcrypto`, PL/pgSQL trigger functions and JSONB builders for the event inbox. It preserves payment, absence, approved-leave, writing-book-stock and approval-state event flows that previously depended on SQLite-specific triggers.

For Cloudflare/D1 fallback deployments, apply the normal migrations including:

```text
0106_agentic_generated_documents.sql
```

## Starting the Node runtime

Copy `.env.selfhost.example` to your protected server environment and set at least:

- `DATABASE_URL`
- `JWT_SECRET`
- `OPENAI_API_KEY`
- `LEDGERLY_STORAGE_DIR`

Then install dependencies and start the server with the repository scripts:

```bash
npm install
npm run start:selfhost
```

The default listener is `127.0.0.1:8080`; place Caddy/Nginx in front of it for TLS and public routing. Keep the storage directory outside ephemeral application directories and include it in your backup/restore plan together with PostgreSQL.

## Document generation model

Every employee has these bounded tools:

- `list_saved_documents` — read-only discovery of saved AI documents in the current organization.
- `prepare_document` — prepares a DOCX, XLSX or PPTX generation action.
- `prepare_print_document` — prepares a saved AI document for Printerly.

`prepare_document` never writes a file immediately. It creates a **suggested Action Center item** requiring `documents:write`. The lifecycle remains:

`Suggested → Prepared → Awaiting approval → Approved → Executing → Executed`

Only execution creates files.

The self-host document service generates and saves two artifacts for each approved document:

1. the editable source (`.docx`, `.xlsx` or `.pptx`), and
2. a canonical `.pdf` companion used for preview/printing.

The metadata row is saved in `ae_generated_documents`, including organization, employee, source/PDF object keys, sizes, PDF page count and SHA-256 checksum.

### Supported structured content

DOCX input supports sections with headings, paragraphs and bullets. XLSX input supports multiple named sheets with row arrays. PPTX input supports multiple slides with titles and bullet/body content. If an employee is given a general structured object, the renderer still produces a readable source file and PDF representation rather than dropping the content.

## Printerly integration

Office formats are not sent straight to a printer. Printerly receives the saved canonical PDF so that the print node receives an established printable format.

Printing requires two governance layers:

1. **Agentic Action Center** — a human must approve and execute `printerly.document.print`.
2. **Printerly governance** — the request then passes through the normal Printerly cost calculation, automatic rules, printer routing, quota reservation, approval workflow and secure-release behavior.

The bridge stages the PDF as a normal `prn_documents` record and creates the print job through the same Printerly services used by the existing `/printerly/jobs` endpoint. It does not bypass quotas or print policies.

The saved Office source remains available even after printing. A user with `documents:read` can download either the original Office file or the printable PDF from the **Agent Documents** page.

## Example employee requests

- Amina: “Prepare a DOCX letter to parents explaining next week’s visitation day.”
- Daniel: “Prepare an XLSX lesson-plan compliance report from the verified supervision data.”
- Grace: “Prepare an XLSX arrears summary from the current posted fee data.”
- Mirembe: “Prepare a PowerPoint management briefing from today’s verified school exceptions.”
- Sarah: “Prepare a DOCX staff leave handover brief from approved leave records.”
- Peter: “Prepare an XLSX writing-book stock report.”

After the file is approved and generated, a user can say, for example, “Print the latest lesson-plan compliance report.” The employee uses `list_saved_documents` to resolve the correct saved record and prepares a Printerly action; it still cannot print autonomously.

## Security boundaries

v1.5 does not give models direct SQL, filesystem, PostgreSQL or Printerly-node access. The model sees only bounded Ledgerly tools. Organization IDs come from the authenticated principal, not model arguments. Document generation and printing require existing Ledgerly `documents:write` authorization. DOS remains an academic-supervision employee and does not gain examination-management permissions.

## Validation

Repository validation should cover:

```bash
npm run modules:sync
npm run typecheck
npm test
npm run build:web
```

The v1.5 CI workflow also exercises the Node self-host process against PostgreSQL, verifies health, and checks that the generated dependency lock is consistent.
