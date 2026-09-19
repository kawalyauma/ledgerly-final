FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code
RUN mkdir -p /home/ledgerly-ai/.claude /workspace \
 && chown -R 1000:1000 /home/ledgerly-ai /workspace \
 && chmod 700 /home/ledgerly-ai /home/ledgerly-ai/.claude
ENV HOME=/home/ledgerly-ai \
    NPM_CONFIG_UPDATE_NOTIFIER=false
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["claude"]
