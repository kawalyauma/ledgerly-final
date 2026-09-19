import { Hono } from "hono";
import type { AppEnv } from "../../http/types.js";
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
      {
        data: {
          name: health.name,
          enabled: health.enabled,
          ready: health.ready,
          status: health.status,
          checkedAt: health.checkedAt,
        },
      },
      health.ready ? 200 : 503,
    );
  });

  routes.get("/meta", (c) =>
    c.json({
      data: {
        name: "Ledgerly AI",
        featureVersion: "0.1.0",
        enabled: service.config.LEDGERLY_AI_ENABLED,
        providerSelection: "managed",
      },
    }),
  );

  return routes;
}
