import { Hono } from "hono";
import type { AppEnv } from "../../http/types.js";
import { requireScope } from "../core-identity/security.js";
import { createLedgerlyAiGatewayRoutes } from "./gateway/routes.js";
import type { LedgerlyAiFoundationService } from "./service.js";

export function createLedgerlyAiRoutes(service: LedgerlyAiFoundationService) {
  const routes = new Hono<AppEnv>();

  routes.get("/health", async (c) => {
    const health = await service.health();
    return c.json({ data: health }, health.status === "degraded" ? 503 : 200);
  });

  routes.get("/ready", async (c) => {
    const health = await service.health();
    return c.json(
      { data: { name: health.name, enabled: health.enabled, ready: health.ready, status: health.status, checkedAt: health.checkedAt } },
      health.ready ? 200 : 503,
    );
  });

  routes.get("/meta", (c) =>
    c.json({ data: { name: "Ledgerly AI", featureVersion: "0.3.0", enabled: service.config.LEDGERLY_AI_ENABLED, providerSelection: "managed" } }),
  );

  routes.get("/internal/providers", requireScope("admin:read"), async (c) => {
    const diagnostics = await service.providers.diagnostics();
    return c.json({
      data: {
        executionMode: service.config.LEDGERLY_AI_EXECUTION_MODE,
        queue: { active: service.providers.queue.active, queued: service.providers.queue.queued },
        providers: diagnostics,
      },
    });
  });

  routes.route("/", createLedgerlyAiGatewayRoutes(service.repository, service.gateway));
  return routes;
}
