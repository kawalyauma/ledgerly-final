# Ledgerly AI CLI workers

Ledgerly AI supports exactly two hidden execution providers:

- Codex CLI
- Claude Code CLI

Build the worker images from the repository root:

```bash
docker build -t ledgerly-ai-codex:local ledgerly-ai/workers/codex
docker build -t ledgerly-ai-claude-code:local ledgerly-ai/workers/claude-code
```

Authentication is never baked into an image. The backend mounts dedicated persistent provider homes:

- `/var/lib/ledgerly-ai/sessions/codex` -> `/home/ledgerly-ai/.codex`
- `/var/lib/ledgerly-ai/sessions/claude-code` -> `/home/ledgerly-ai`

Authenticate those private homes administratively and protect them like password stores. Normal Ledgerly users never receive provider names, raw provider event logs, or credentials.

## Host preparation

The API container and provider workers intentionally run as the non-root Node user (UID 1000). Create the same-path host directories before starting the stack:

```bash
sudo install -d -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions
sudo install -d -o 1000 -g 1000 /var/lib/ledgerly-ai/workspaces
sudo install -d -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions/codex
sudo install -d -o 1000 -g 1000 /var/lib/ledgerly-ai/sessions/claude-code
```

## Docker execution

Production defaults to `LEDGERLY_AI_EXECUTION_MODE=docker`. Each job receives:

- a read-only container root;
- dropped Linux capabilities;
- no-new-privileges;
- CPU, memory and PID limits;
- a temporary writable `/tmp`;
- a writable job workspace;
- only the selected provider's session home.

The API container needs access to the host Docker socket. Set `DOCKER_GID` to the Docker socket's group ID before starting Compose:

```bash
export DOCKER_GID="$(stat -c '%g' /var/run/docker.sock)"
docker compose up -d
```

The session/workspace paths are mounted at the same absolute paths inside the API container so the host Docker daemon can resolve job mounts correctly.
