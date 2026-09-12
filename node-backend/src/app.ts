import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { BackendFeature } from "./features/types.js";
import type { HealthChecker } from "./health/service.js";
import type { AppEnv } from "./http/types.js";
import type { Runtime } from "./runtime.js";

export function createApp(options: {
  environment: string;
  corsOrigins: string[];
  health: HealthChecker;
  features?: BackendFeature[];
  runtime?: Runtime;
}) {
  const app = new Hono<AppEnv>();
  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use("/api/*", cors({
    origin: options.corsOrigins.includes("*") ? "*" : options.corsOrigins,
    allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Organization-Id", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }));

  app.get("/", (c) => c.json({
    name: "Ledgerly Node API",
    runtime: "node",
    stage: "foundation",
    apiVersion: "v1",
    features: (options.features ?? []).map((feature) => ({ key: feature.key, version: feature.version })),
  }));
  app.get("/system/live", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));
  app.get("/system/health", async (c) => {
    const health = await options.health.check();
    return c.json(health, health.status === "ok" ? 200 : 503);
  });

  for (const feature of options.features ?? []) {
    if (!feature.mount) continue;
    if (!options.runtime) throw new Error(`Runtime is required to mount feature ${feature.key}`);
    feature.mount(app, options.runtime);
  }

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route not found", requestId: c.get("requestId") } }, 404));
  app.onError((error, c) => {
    console.error(JSON.stringify({ level: "error", requestId: c.get("requestId"), message: error.message, stack: error.stack }));
    return c.json({ error: { code: "INTERNAL_ERROR", message: options.environment === "development" ? error.message : "The request could not be completed.", requestId: c.get("requestId") } }, 500);
  });
  return app;
}
