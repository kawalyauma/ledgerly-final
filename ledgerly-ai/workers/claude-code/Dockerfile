FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code
RUN useradd --create-home --uid 10001 --shell /bin/bash ledgerly-ai
USER ledgerly-ai
WORKDIR /workspace
ENTRYPOINT ["claude"]
