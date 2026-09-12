import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { HealthChecker } from "../src/health/service.js";

const healthy: HealthChecker = {
  async check() {
    return { status: "ok", timestamp: new Date().toISOString(), components: {} };
  },
};

describe("foundation API", () => {
  it("exposes liveness without business modules", async () => {
    const app = createApp({ environment: "test", corsOrigins: ["*"], health: healthy });
    const response = await app.request("/system/live");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("reports that the backend is foundation-only", async () => {
    const app = createApp({ environment: "test", corsOrigins: ["*"], health: healthy });
    const response = await app.request("/");
    expect(await response.json()).toMatchObject({ name: "Ledgerly Node API", stage: "foundation", features: [] });
  });
});
