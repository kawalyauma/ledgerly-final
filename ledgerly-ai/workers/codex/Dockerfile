FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex
RUN mkdir -p /home/ledgerly-ai/.codex && chown -R node:node /home/ledgerly-ai
USER node
WORKDIR /workspace
ENTRYPOINT ["codex"]
