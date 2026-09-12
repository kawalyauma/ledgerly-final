import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { features } from "../src/features/index.js";

describe("mobile sync feature registry", () => {
  it("registers mobile-sync after finance-mobile", () => {
    const keys = features.map((feature) => feature.key);
    expect(keys).toContain("mobile-sync");
    expect(keys.indexOf("mobile-sync")).toBeGreaterThan(keys.indexOf("finance-mobile"));
  });

  it("requires authentication for versioned APIs while leaving offline exchange public", async () => {
    const runtime: any = {
      config: { NODE_ENV: "test", JWT_SECRET: "x".repeat(32), JWT_ISSUER: "your-finance-pro", JWT_AUDIENCE: "your-finance-pro-api" },
      db: { query: async () => ({ rows: [], rowCount: 0 }) },
    };
    const health: any = { check: async () => ({ status: "ok" }) };
    const app = createApp({ environment: "test", corsOrigins: ["*"], health, features: [], runtime });
    const protectedResponse = await app.request("/api/v1/reports/");
    expect(protectedResponse.status).toBe(401);
    const publicResponse = await app.request("/api/v1/mobile-sync/offline/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(publicResponse.status).not.toBe(401);
  });
});
