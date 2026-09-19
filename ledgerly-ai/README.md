# Ledgerly AI

Ledgerly AI is Ledgerly's internal AI platform. It provides the shared runtime for chats, memory, named AI employees, user-created agents, engineering employees, tools, incidents, approvals, and audit trails.

## Provider policy

Ledgerly AI has exactly two execution providers:

- Codex CLI
- Claude Code CLI

Provider identity is infrastructure metadata. Ordinary Ledgerly users interact with **Ledgerly AI** and named Ledgerly AI employees; they do not select or see the underlying provider.

## Backend module

The production Node integration lives in:

`node-backend/src/features/ledgerly-ai/`

The PostgreSQL schema is introduced by:

`node-backend/migrations/0103_ledgerly_ai_foundation.sql`

## Foundation boundaries

Phase 1 intentionally does not execute either CLI. It establishes configuration, contracts, persistence, service bootstrap, health/readiness, and structured logging. Provider workers are added in Phase 2.
