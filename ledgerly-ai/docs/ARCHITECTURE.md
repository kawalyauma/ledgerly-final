# Ledgerly AI Architecture

Ledgerly AI is Ledgerly's internal AI platform. It provides one governed runtime for user chat, persistent memory, named AI employees, user-created employees, tools/actions, engineering incidents, Git governance, monitoring, approvals, and audit evidence.

## Provider policy

Ledgerly AI supports exactly two hidden execution providers:

- Codex CLI
- Claude Code CLI

The configured provider IDs are `codex` and `claude-code`. No ordinary Ledgerly user chooses or sees the provider. Public responses are normalized to Ledgerly AI/named-employee identity. Provider selection, health, execution events, session identifiers, and credentials are administrative infrastructure details.

The default provider and fallback provider must be different. Provider routing considers task capability, provider health/session readiness, default preference, recent success/failure statistics, task kind, latency, and optional soft hourly limits.

## High-level flow

```text
Ledgerly user / existing Agentic Employee
                 |
                 v
        Ledgerly AI Gateway
                 |
       +---------+---------+
       |         |         |
       v         v         v
   Chat state  Memory   Employee identity
       |         |         |
       +---------+---------+
                 |
          Tool/Policy layer
                 |
        +--------+--------+
        |                 |
        v                 v
  read/governed tools   provider runtime
                          |
                  Codex / Claude Code
```

Engineering work adds a separate governed path:

```text
runtime signal -> incident -> specialist employee -> isolated Git workspace
 -> provider worker -> verification -> independent QA -> governed commit
 -> optional PR/CI -> isolated staging -> production approval
 -> deployment record -> post-deploy verification / rollback
```

## Core backend areas

Production implementation lives under `node-backend/src/features/ledgerly-ai/`.

Important subsystems:

- `gateway/`: chats, requests, context construction, response normalization, idempotency and public API flow.
- `providers/`: Codex/Claude adapters, routing, queueing, subprocess execution and provider sessions.
- `memory/`: chat, user, agent, organization and project memory.
- `employees/`: built-in employee identity and tenant-specific materialization.
- `tools/`: capability catalog, permission checks, approvals and safe application tools.
- `forge/`: conversational custom-employee creation, preview, sandbox and activation.
- `custom-runtime/`: custom employee sharing, triggers, events, manual runs and metrics.
- `incidents/`: engineering incident classification and fix/test/staging/approval workflow.
- `git/`: isolated worktrees, governed agent branches, commits, PRs and CI state.
- `monitoring/`: runtime monitoring and incident signals.
- `policy/`: risk decisions, approvals, emergency controls and immutable privileged audit.
- `security/`: prompt/context boundaries, tool-boundary injection checks and engineering command policy.

## Named employees

Built-in employees are stored per organization from `lai_agent_templates`.

| Employee | Role | Primary responsibility |
|---|---|---|
| Amani | AI Manager and Dispatcher | coordination, delegation and cross-module planning |
| Kato | Backend Engineer | APIs, services, backend incidents and code review |
| Maya | Frontend Engineer | UI, UX, accessibility and frontend incidents |
| Tendo | Database Engineer | schema, queries, migrations, integrity and performance |
| Nia | QA Engineer | verification, regression testing and independent fix review |
| Jabali | DevOps Engineer | containers, runtime health, deployments, queues and observability |
| Safi | Security Engineer | permissions, secrets, attack surfaces and security review |
| Elimu | Academic Analyst | attendance, lesson delivery, learner progress and academics |
| Hesabu | Finance Analyst | fees, accounting, payments, payroll and financial analysis |
| Ripoti | Reporting Specialist | operational, academic, financial and exception reports |
| Kumbuka | Memory Assistant | memory capture, retrieval, correction and organization |
| Forge | Agent Creation AI | guided creation of custom Ledgerly AI employees |

An employee's effective authority is never the employee definition alone. It is the intersection of:

1. the authenticated user's Ledgerly role/scopes;
2. the employee's permission list;
3. the employee's tool allowlist;
4. the tool's own required scopes/risk classification;
5. organization policy/approval rules.

## Memory model

Supported scopes are:

- `chat`: one conversation;
- `user`: one user;
- `agent`: one employee;
- `organization`: tenant-wide memory;
- `project`: a Tasks & Work project.

Every memory record is organization-scoped. User memory defaults to the authenticated user. Organization/agent/project writes require the applicable Ledgerly authority. Memory supports provenance, confidence, importance, pinning, expiry, corrections and audit history.

Memory is context, not authority. Prompts, memory, attachments and tool/provider text cannot change the current user's organization, role, scopes, employee permissions, tool policy or approval requirements.

## Forge custom-employee lifecycle

Forge is the required creation path for custom employees.

1. A user starts a Forge builder session.
2. Forge gathers name, role, purpose, description, responsibilities and capabilities conversationally.
3. Forge proposes tools, permissions, memory, triggers, communications, approval rules and response style.
4. Server-side normalization removes any permission or tool the creator does not possess.
5. Read-only agents have mutating tools removed.
6. Governed-action agents may use only writes/actions that remain approval-governed.
7. Non-admin users cannot create organization-wide memory authority or admin-only visibility.
8. The user reviews the generated preview/readiness score.
9. Sandbox testing is available at sufficient readiness so the user can test the employee before activation.
10. Activation creates/version-controls the custom employee and its runtime configuration.

Custom employees can later be revised, cloned, enabled/disabled, shared, scheduled, triggered, run manually and inspected through history/metrics.

## Engineering incident lifecycle

Engineering incidents can come from HTTP failures, exceptions, queue/runtime signals, health monitoring or manual input.

The lifecycle is:

1. classify and fingerprint the signal;
2. deduplicate repeated failures inside the tenant;
3. assign an engineering employee;
4. respect organization/employee pause or emergency-stop controls;
5. create an isolated `agent/*` Git worktree/branch;
6. collect bounded/redacted runtime evidence;
7. run the engineering worker in `workspace-write` Docker isolation;
8. reject protected secret/session path changes;
9. run fixed verification commands;
10. run Nia's independent read-only QA review;
11. commit through governed Git metadata;
12. optionally create a PR and track required CI;
13. deploy to isolated staging and run smoke checks;
14. calculate change risk and request human production approval;
15. record production deployment only after approval and Git/CI readiness;
16. perform post-deployment health/recurrence verification;
17. close the incident on success or return it to fixing on rollback.

Production mutations are never inferred from provider text. They require verified application/tool/Git state.

## Permissions, policy and safety

Default policy behavior:

- low-risk read-only operations may run automatically;
- medium-risk mutations/approval-marked actions require one administrator approval;
- high-risk actions require one administrator approval;
- critical actions require two distinct owner approvals;
- destructive production actions are denied unless an explicit owner-managed policy rule permits them, and owner approval still remains mandatory.

Owners can configure policy rules. Organization/agent autonomy can be `active`, `paused` or `stopped`. Organization emergency stop is owner-controlled.

Security boundaries include:

- tenant predicates on persistent records and safe SQL;
- authenticated identity facts cannot be overridden by user prompts, memories or attachments;
- structured tool arguments cannot inject role/scope/authorization/system-control overrides;
- provider subprocesses receive an explicit environment allowlist rather than the backend environment;
- provider output and persisted diagnostics are secret-redacted;
- engineering workers are Docker-isolated for write access;
- host network, privileged containers and sensitive host mounts are denied;
- protected branches and protected secret/session paths cannot be committed by AI workers;
- privileged security/approval activity is written to immutable audit tables.

## Public API surfaces

The authenticated Ledgerly AI mount is `/api/v1/ledgerly-ai`.

Major areas include:

- `/meta`, `/health`, `/ready`
- `/prompt`, `/chat`, `/chat/stream`
- `/my/chats`, `/my/jobs`
- `/employees`
- `/memories`
- `/tools`, `/approvals`
- `/forge`
- `/custom-agents`
- `/incidents`
- `/git`
- `/monitoring`
- `/policy`
- `/console`

Provider diagnostics are intentionally under administrative internal routes.
