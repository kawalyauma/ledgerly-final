# Ledgerly AI Operations Guide

This guide covers deployment, provider-session maintenance, incident operations, approvals, rollback and troubleshooting for the self-hosted Node/PostgreSQL Ledgerly AI runtime.

## Baseline configuration

Ledgerly AI is enabled by default. Production should normally use:

```bash
LEDGERLY_AI_ENABLED=true
LEDGERLY_AI_EXECUTION_MODE=docker
LEDGERLY_AI_DEFAULT_PROVIDER=codex
LEDGERLY_AI_FALLBACK_PROVIDER=claude-code
LEDGERLY_AI_SESSION_ROOT=/var/lib/ledgerly-ai/sessions
LEDGERLY_AI_WORK_ROOT=/var/lib/ledgerly-ai/workspaces
```

Only `codex` and `claude-code` are valid provider IDs.

Important capacity/safety controls include:

- `LEDGERLY_AI_MAX_CONCURRENCY` — provider jobs executing at once; default 4.
- `LEDGERLY_AI_MAX_QUEUE` — pending provider jobs; default 100.
- `LEDGERLY_AI_JOB_TIMEOUT_MS` — normal provider job timeout; default 300000.
- `LEDGERLY_AI_MAX_OUTPUT_BYTES` — captured provider output cap; default 4 MiB.
- `LEDGERLY_AI_RETRY_ATTEMPTS` and `LEDGERLY_AI_RETRY_BACKOFF_MS`.
- `LEDGERLY_AI_WORKER_MEMORY_MB` — default 3072.
- `LEDGERLY_AI_WORKER_CPUS` — default 2.
- `LEDGERLY_AI_WORKER_PIDS` — default 256.
- `LEDGERLY_AI_WORKER_NOFILE` — default 1024.
- `LEDGERLY_AI_WORKER_TMPFS_MB` — default 512.
- `LEDGERLY_AI_WORKER_MAX_TURNS` — default 12.
- `LEDGERLY_AI_DOCKER_NETWORK` — defaults to `bridge`; `host` is rejected.
- user/org/agent request-rate limits in the `LEDGERLY_AI_*_REQUESTS_PER_MINUTE` settings.

Do not set `LEDGERLY_AI_LOG_PROMPTS=true` in production unless there is an explicit operational reason and the logging destination has been reviewed for privacy.

## Host preparation

Provider homes and workspaces are private operational state:

```bash
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ledgerly-ai/workspaces
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions/codex
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions/claude-code
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions/claude-code/.claude
```

The runtime re-applies private directory permissions at provider initialization.

Build worker images from the repository root:

```bash
docker build -t ledgerly-ai-codex:local ledgerly-ai/workers/codex
docker build -t ledgerly-ai-claude-code:local ledgerly-ai/workers/claude-code
```

## Provider authentication/session maintenance

Authentication is not stored in worker images and must not be placed in application environment variables.

Ledgerly AI expects persistent provider session homes:

- Codex: `/var/lib/ledgerly-ai/sessions/codex`
- Claude Code: `/var/lib/ledgerly-ai/sessions/claude-code`

Readiness markers checked by the backend are:

- Codex: `/var/lib/ledgerly-ai/sessions/codex/auth.json`.
- Claude Code: `/var/lib/ledgerly-ai/sessions/claude-code/.claude/.credentials.json`.

Provider session directories use mode `0700`; credential files must remain owner-only.

Credential files must not be group/world accessible. The runtime treats a provider as not configured when the marker file is absent, empty or has group/world permission bits.

To establish or refresh authentication:

1. stop or drain Ledgerly AI provider work;
2. run the corresponding provider CLI interactively as UID/GID 1000 with only that provider's session directory mounted as its home;
3. complete the provider's current supported interactive authentication flow;
4. confirm the expected marker file exists and contains data;
5. set the marker and session directories to owner-only permissions;
6. start/reload Ledgerly AI and verify provider diagnostics from the admin console/internal provider endpoint.

Never copy another user's session directory into production. Never commit provider session files to Git. Never place them in ordinary application backups without encryption and separate access control.

## Health and readiness

Platform health:

```bash
curl -fsS http://127.0.0.1:8080/system/live
curl -fsS http://127.0.0.1:8080/system/health
```

Ledgerly AI health/readiness are authenticated under:

- `GET /api/v1/ledgerly-ai/health`
- `GET /api/v1/ledgerly-ai/ready`

Administrative provider diagnostics are exposed through the Ledgerly AI internal provider route and Admin Console. A provider is usable only when the executable/image is healthy and the private session is configured.

## Worker isolation

Workspace-write provider jobs require Docker. Local mode cannot perform workspace-write jobs.

Worker containers use:

- non-root UID/GID 1000;
- read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges`;
- isolated IPC;
- memory, CPU, PID and file-descriptor limits;
- `/tmp` tmpfs with `noexec,nosuid,nodev`;
- one bounded workspace mount;
- only the selected provider's session home.

Do not weaken these flags to fix a provider error. Diagnose the provider/session/workspace problem instead.

## Git and engineering operations

Engineering work uses `agent/*` branches only. Protected branches default to `main,master,production`.

Relevant settings:

```bash
LEDGERLY_AI_REPO_ROOT=/opt/ledgerly/source
LEDGERLY_AI_GIT_BASE_BRANCH=main
LEDGERLY_AI_GIT_REMOTE=origin
LEDGERLY_AI_GIT_PROTECTED_BRANCHES=main,master,production
LEDGERLY_AI_GIT_AUTO_PR=false
LEDGERLY_AI_GIT_REQUIRED_CHECKS=
```

If auto-PR is enabled, configure the repository and GitHub credential using the Ledgerly AI Git settings. Treat the GitHub token as a backend secret; it is deliberately excluded from provider subprocess environments.

The engineering command boundary permits only fixed Git/npm/test/Docker command families. Arbitrary shells are not part of the engineering tool surface.

## Incident operation

An incident normally advances:

`open -> investigating -> fixing -> testing -> staging -> awaiting_approval -> deployed -> closed`

Failures can move it to `failed`; approved production rollback moves it back to `fixing`.

Operator actions:

- retry only an `open` or `failed` incident;
- inspect changed paths, checks, QA result and staging smoke evidence before approval;
- do not record production deployment before the approval is fully satisfied;
- where Git governance requires a PR/CI, production readiness also requires a merged governed PR and passing configured checks;
- after deployment, run verification/close only when platform health is clean and the incident signature has not recurred;
- use production rollback recording when a deployed change must be reverted.

Critical changes require two distinct owner approvals. The same user cannot count twice toward a two-step approval.

## Pause and emergency stop

Organization and per-agent controls support:

- `active`
- `paused`
- `stopped`

Paused/stopped scopes block autonomous employee work. The organization emergency stop can only be engaged/released by the organization owner.

Use pause for maintenance/investigation. Use stop for an immediate halt to autonomous AI activity. Do not delete incidents/jobs as a substitute for the emergency control.

## Deployment procedure

A safe release sequence is:

1. take/verify a PostgreSQL backup;
2. preserve an encrypted backup of provider session state if session rotation is not planned;
3. deploy application code and migrations;
4. rebuild the two Ledgerly AI worker images;
5. verify host directory ownership/permissions;
6. start PostgreSQL, Redis/object storage and the Node runtime;
7. run database migrations;
8. verify `/system/live` and `/system/health`;
9. verify Ledgerly AI readiness and both provider diagnostics;
10. run the Ledgerly AI authenticated smoke suite;
11. verify the Admin Console can inspect employees, policy, jobs and incidents;
12. watch incident/monitoring queues after release.

The repository CI workflow also typechecks/builds the frontend, checks the backend, runs migrations/tests, builds both worker images, checks isolated CLI startup and runs the authenticated smoke suite when a runner is available.

## Rollback procedure

Application rollback:

1. engage organization pause/stop if autonomous work could worsen the incident;
2. stop new deployments;
3. restore/redeploy the previous known-good application ref/image;
4. do not reverse database migrations blindly; use the migration-specific recovery plan;
5. verify platform health;
6. verify Ledgerly AI schema compatibility;
7. rebuild/reselect worker images matching the application release if required;
8. record the production rollback on any Ledgerly AI engineering incident so its state returns to `fixing`;
9. preserve incident/audit evidence for postmortem.

Provider-session rollback is separate from application rollback. Restore a provider session only from an encrypted trusted backup; otherwise re-authenticate the CLI.

## Troubleshooting

### Provider shows unavailable

Check:

1. worker image/CLI can run `--version`;
2. the expected credential marker exists;
3. marker file is non-empty and owner-only;
4. session directory ownership is UID/GID 1000;
5. the provider is below any configured soft hourly limit;
6. queue is not saturated.

Do not solve this by passing backend API keys, database URLs or application secrets into the provider environment.

### Queue full

Inspect active/queued provider counts. Reduce incoming workload, wait for current jobs to drain, investigate stuck jobs, then adjust concurrency/queue limits only after checking host CPU/RAM.

### Workspace-write fails

Confirm Docker execution mode, work root permissions, workspace is under `LEDGERLY_AI_WORK_ROOT`, and Docker can bind the configured absolute host paths. Local mode intentionally rejects workspace-write.

### Engineering command denied

The command policy is intentionally restrictive. Add a new structured tool/allowlisted operation with tests rather than invoking a shell or bypassing the policy.

### Incident repeatedly reopens

Inspect the incident fingerprint, recurrence timestamp, deployed ref, monitoring evidence and post-deployment health. A closed failure that recurs is treated as a regression and receives elevated attention/risk.

### Production approval will not complete

Check approval mode, required reviewer role, distinct reviewers, expiry and current incident change risk. Critical approvals require two owners.

### Memory appears missing

Verify tenant, scope type/scope ID, expiry/deleted state, required scope, user membership and whether the current user/employee is authorized for that memory scope.

### Frontend builds but AI route fails

Check Node API mount/version in the root feature list, authentication, migrations `0103–0114`, and `/api/v1/ledgerly-ai/meta`.

### Both providers unavailable

The request should fail cleanly rather than silently use an unapproved provider. Restore one of the two provider sessions/worker images and retry. Adding another model/provider is a policy change, not a runtime fallback.
