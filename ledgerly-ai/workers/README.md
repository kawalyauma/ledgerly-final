# Ledgerly AI CLI Workers

Ledgerly AI supports exactly two hidden execution providers:

- Codex CLI
- Claude Code CLI

Provider identity is operational infrastructure. Ordinary Ledgerly users see Ledgerly AI/named employees only.

## Build

From the repository root:

```bash
docker build -t ledgerly-ai-codex:local ledgerly-ai/workers/codex
docker build -t ledgerly-ai-claude-code:local ledgerly-ai/workers/claude-code
```

Authentication is never baked into worker images.

## Provider session homes

Persistent private provider homes:

- `/var/lib/ledgerly-ai/sessions/codex` -> Codex home
- `/var/lib/ledgerly-ai/sessions/claude-code` -> Claude Code home

Backend readiness markers:

- Codex: `auth.json`
- Claude Code: `.claude/.credentials.json`

The marker must exist, be non-empty and have no group/world permission bits.

## Host preparation

The API process and worker containers use UID/GID 1000 for provider session/workspace ownership.

```bash
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ledgerly-ai/workspaces
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions/codex
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions/claude-code
sudo install -d -m 700 -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions/claude-code/.claude
```

## Authentication maintenance

Use the current supported interactive login flow of each installed provider CLI while mounting only that provider's session home and running as UID/GID 1000.

After authentication:

1. verify the expected marker exists and is non-empty;
2. set directories to `0700`;
3. set credential files to owner-only permissions;
4. restart/reload provider readiness;
5. verify the internal provider diagnostics.

Do not:

- store provider credentials in Dockerfiles;
- inject backend/database/JWT/GitHub secrets into provider containers;
- commit session files;
- share one operator's provider home across unrelated environments;
- expose provider names/session IDs to ordinary Ledgerly users.

## Runtime isolation

Production defaults to `LEDGERLY_AI_EXECUTION_MODE=docker`.

Workspace-write jobs are rejected in local mode.

Each provider worker receives:

- non-root `1000:1000`;
- read-only root filesystem;
- `--cap-drop=ALL`;
- `--security-opt=no-new-privileges`;
- isolated IPC;
- CPU/memory/PID/nofile limits;
- a bounded `/tmp` tmpfs with `noexec,nosuid,nodev`;
- one job workspace under `LEDGERLY_AI_WORK_ROOT`;
- only the selected provider's session home.

The provider worker must never receive:

- the Docker socket;
- host PID/network namespace;
- `/proc` or `/sys` mounts;
- the complete backend environment;
- database/Redis/JWT/application secrets.

The backend/orchestrator may require access to the host Docker daemon in a self-hosted deployment so it can create isolated provider/staging containers. That access belongs to the orchestrator, not to the provider workers, and should be protected as privileged host access.

If Compose grants the API container Docker-socket access, configure the socket group deliberately and avoid granting the same mount to any AI worker.

## Resource defaults

Current defaults are:

- memory: 3072 MiB
- CPUs: 2
- PIDs: 256
- nofile: 1024
- tmpfs: 512 MiB
- max turns: 12

All are configurable through the `LEDGERLY_AI_WORKER_*` environment settings.

## Health check

The CI workflow builds both images and runs each image with network disabled, read-only rootfs, dropped capabilities and resource limits to verify the CLI can start with `--version`.

Provider readiness in production additionally requires the private session marker.
