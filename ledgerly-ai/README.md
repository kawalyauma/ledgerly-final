# Ledgerly AI

Ledgerly AI is Ledgerly's governed AI platform for user chat, persistent memory, named AI employees, Forge-created custom employees, tools/actions, engineering incidents, approvals, monitoring and audit.

Current feature version: **0.18.0**.

## Provider policy

Ledgerly AI has exactly two hidden execution providers:

- Codex CLI
- Claude Code CLI

Ordinary Ledgerly users interact with **Ledgerly AI** and named employees such as Amani, Elimu, Hesabu, Kato, Nia and Forge. They do not select or see the underlying provider/model.

The Node runtime enforces that the configured default and fallback providers are different and belong to the two-provider allowlist.

## Implementation

Backend:

`node-backend/src/features/ledgerly-ai/`

Frontend module:

`modules/ledgerly-ai/`

Worker images:

`ledgerly-ai/workers/`

PostgreSQL schema:

`node-backend/migrations/0103_ledgerly_ai_foundation.sql` through `0114_ledgerly_ai_policy_controls.sql`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — runtime structure, employees, memory, Forge, incident flow, permissions and safety.
- [Operations](docs/OPERATIONS.md) — deployment, provider sessions, worker isolation, health, approvals, rollback and troubleshooting.
- [Backup and recovery](docs/BACKUP_RECOVERY.md) — persistent data scope, provider sessions, restore order and verification.
- [CLI workers](workers/README.md) — image build, host preparation and worker-specific isolation.

## Main user experiences

- Ask Ledgerly AI
- named employee selection
- My AI Employees
- recent/saved chats
- permission-scoped memory
- governed tools/actions with approval prompts
- Forge-guided employee creation
- custom employee triggers/sharing/history
- admin AI console
- autonomous engineering incident workflow

Existing Agentic Employees use the Ledgerly AI gateway/runtime instead of owning provider integrations directly.

## Security model

Authority is derived from the authenticated Ledgerly principal and then intersected with the employee/tool/policy boundary. Prompts, memory, attachments and provider output are never authority.

Engineering writes require Docker isolation. Provider workers do not receive Ledgerly database/JWT/application secrets. Tool and engineering command boundaries are structured/allowlisted. Privileged activity is audited.

See [Architecture](docs/ARCHITECTURE.md) and [Operations](docs/OPERATIONS.md) for details.

## Reliability

Phase 17 added:

- Codex and Claude Code adapter integration tests;
- provider failover and dual-provider outage recovery;
- PostgreSQL chat/job/memory persistence tests;
- multi-tenant integration tests;
- full engineering incident workflow tests;
- production approval/deployment/rollback tests;
- concurrency/backpressure tests;
- worker-image startup checks;
- authenticated end-to-end Ledgerly AI smoke tests.

The CI workflow is `.github/workflows/ledgerly-ai-ci.yml`.
