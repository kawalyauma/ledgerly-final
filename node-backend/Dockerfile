FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io ca-certificates git ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && npm install --omit=dev \
 && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
CMD ["node", "dist/server.js"]
