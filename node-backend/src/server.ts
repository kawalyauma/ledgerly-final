import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { features } from "./features/index.js";
import { PlatformHealth } from "./health/service.js";
import { createRuntime } from "./runtime.js";

const runtime = await createRuntime();
const health = new PlatformHealth(runtime);
const app = createApp({
  environment: runtime.config.NODE_ENV,
  corsOrigins: runtime.config.CORS_ORIGINS,
  health,
  features,
  runtime,
});

const server = serve({ fetch: app.fetch, hostname: runtime.config.HOST, port: runtime.config.PORT }, (info) => {
  runtime.logger.info({ host: runtime.config.HOST, port: info.port }, "Ledgerly Node API listening");
});

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  runtime.logger.info({ signal }, "Shutting down API");
  server.close(async () => {
    await runtime.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
