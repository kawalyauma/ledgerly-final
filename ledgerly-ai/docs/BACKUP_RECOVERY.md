# Ledgerly AI Backup and Recovery

Ledgerly AI contains durable user conversations, memory, custom employee definitions, incident history, approvals and audit evidence. These records must be included in the platform's PostgreSQL backup/restore plan.

## What is durable

The Ledgerly AI schema is introduced/extended by migrations `0103–0114`.

### Core/chat/provider state

- `lai_settings`
- `lai_agents`
- `lai_agent_templates`
- `lai_chats`
- `lai_messages`
- `lai_jobs`
- `lai_provider_executions`
- `lai_tool_calls`
- `lai_idempotency_keys`
- `lai_rate_counters`

### Memory

- `lai_memories`
- `lai_memory_audit`

### Agentic/Forge/custom employees

- `lai_agent_handoffs`
- `lai_agent_activity`
- `lai_agent_builder_sessions`
- `lai_agent_builder_messages`
- `lai_agent_versions`
- `lai_agent_sandbox_runs`
- `lai_custom_agent_shares`
- `lai_custom_agent_triggers`
- `lai_custom_agent_events`
- `lai_custom_agent_runs`

### Engineering/incidents/Git

- `lai_incidents`
- `lai_incident_events`
- `lai_incident_checks`
- `lai_incident_deployments`
- `lai_git_workspaces`
- `lai_git_commits`
- `lai_git_pull_requests`
- `lai_git_ci_checks`

### Monitoring/policy/audit

- `lai_monitor_samples`
- `lai_monitor_state`
- `lai_monitor_summaries`
- `lai_approvals`
- `lai_approval_reviews`
- `lai_policy_rules`
- `lai_ai_controls`
- `lai_audit_events`
- `lai_privileged_audit`

Some audit/review records are intentionally immutable through normal database operations. Restore them from backup rather than trying to reconstruct or rewrite them after an incident.

## Provider sessions

Provider authentication is durable operational state but is not stored in PostgreSQL:

- `/var/lib/ledgerly-ai/sessions/codex`
- `/var/lib/ledgerly-ai/sessions/claude-code`

These directories contain credentials/session material. Back them up only if:

- the backup is encrypted;
- access is restricted independently from ordinary database backups;
- retention is approved;
- restore access is audited.

It is acceptable to exclude provider sessions from normal backups and re-authenticate both CLIs after recovery. This is safer when operational continuity does not require preserving subscription sessions.

## What not to treat as authoritative backup data

`LEDGERLY_AI_WORK_ROOT` contains disposable job/Git workspaces. The authoritative code history is the Git repository/remote plus Ledgerly AI Git metadata in PostgreSQL. Workspaces should normally be recreated rather than restored.

Worker images should be reproducible from:

- `ledgerly-ai/workers/codex/Dockerfile`
- `ledgerly-ai/workers/claude-code/Dockerfile`

Do not back up the Docker socket, host `/proc`, `/sys`, or arbitrary provider container filesystems.

## Backup requirements

A production backup policy should define an explicit recovery-point objective (RPO) and recovery-time objective (RTO), then provide:

1. scheduled PostgreSQL backups covering the entire Ledgerly database, not only the `lai_*` tables;
2. transaction-consistent backups;
3. encrypted off-host/off-machine copies;
4. retention appropriate to school/organization data policy;
5. periodic restore tests;
6. separate protection for provider session credentials if those are backed up;
7. Git repository/remote redundancy for governed engineering commits/branches;
8. backup monitoring and operator-visible failure alerts.

Example logical PostgreSQL backup using a preconfigured PostgreSQL service and protected password file:

```bash
PGSERVICE=ledgerly-backup pg_dump \
  --format=custom \
  --file=/secure-backups/ledgerly-$(date +%F).dump
```

Keep the PostgreSQL service/password configuration outside the repository with owner-only permissions. Do not place database URLs/passwords in command arguments, logs, CI output or shell history.

## Recovery order

Recommended recovery order:

1. provision the correct Ledgerly application release;
2. restore PostgreSQL;
3. restore object storage according to the wider Ledgerly recovery plan;
4. run only migrations newer than the restored schema version;
5. restore/recreate Redis as appropriate; Redis is not the authoritative Ledgerly AI record store;
6. recreate private Ledgerly AI session/work directories with UID/GID 1000 and mode 0700;
7. restore encrypted provider sessions or re-authenticate Codex and Claude Code;
8. rebuild the two provider worker images;
9. restore/verify the Git checkout/remote;
10. start Node API/queue/scheduler services;
11. verify platform health;
12. verify Ledgerly AI health/readiness/provider diagnostics;
13. run the authenticated Ledgerly AI smoke test;
14. inspect recent incidents, approvals, autonomous controls and privileged audit before re-enabling autonomous work.

## Recovery verification

After restore, verify at minimum:

- chats/messages can be listed by the owning tenant/user;
- memory records preserve scope, provenance and correction/audit history;
- tenant-specific built-in employees materialize correctly;
- custom employees preserve versions, shares, triggers and status;
- pending approvals still have the correct required reviewer count/role;
- organization/agent pause or stop controls are preserved;
- open incidents retain events, checks, deployments and Git metadata;
- privileged/audit records are present;
- both providers are either intentionally unconfigured or pass diagnostics;
- no provider/session credential is exposed through logs or public APIs.

## Partial-loss guidance

If PostgreSQL is lost but Git remains, source changes may be recoverable from Git, but Ledgerly AI chat, memory, approval, incident and audit history is not reconstructable reliably. Restore PostgreSQL from backup.

If provider sessions are lost but PostgreSQL remains, do not modify chat/employee state. Restore only from an encrypted trusted backup, or re-authenticate the affected provider and verify diagnostics.

If an AI workspace is lost, recreate it from the governed Git branch/workspace record when practical; do not restore arbitrary temporary filesystem state over a current workspace.

If a Git remote is unavailable but PostgreSQL remains, pause autonomous engineering activity until source-control integrity and protected-branch governance are restored.

## Restore testing

A backup is not considered proven until restored into an isolated environment and checked with:

- database migration/schema checks;
- Ledgerly AI PostgreSQL reliability tests;
- worker image startup checks;
- authenticated smoke tests;
- tenant-isolation checks;
- incident approval/deployment/rollback tests.

Record the restore date, backup identifier, release SHA, schema state, test results and operator who performed the test.
