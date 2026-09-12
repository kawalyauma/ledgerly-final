import type { Runtime } from "../runtime.js";

export type HealthResult = {
  status: "ok" | "degraded";
  timestamp: string;
  components: Record<string, { status: "ok" | "error"; latencyMs: number; error?: string }>;
};

export interface HealthChecker { check(): Promise<HealthResult>; }

export class PlatformHealth implements HealthChecker {
  constructor(private readonly runtime: Runtime) {}

  async check(): Promise<HealthResult> {
    const checks: Array<[string, () => Promise<unknown>]> = [
      ["postgres", () => this.runtime.db.query("SELECT 1")],
      ["redis", () => this.runtime.cache.ping()],
      ["storage", () => this.runtime.storage.healthcheck()],
    ];
    const components: HealthResult["components"] = {};
    for (const [name, check] of checks) {
      const started = performance.now();
      try {
        await check();
        components[name] = { status: "ok", latencyMs: Math.round(performance.now() - started) };
      } catch (error) {
        components[name] = { status: "error", latencyMs: Math.round(performance.now() - started), error: error instanceof Error ? error.message : String(error) };
      }
    }
    return {
      status: Object.values(components).every((component) => component.status === "ok") ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      components,
    };
  }
}
