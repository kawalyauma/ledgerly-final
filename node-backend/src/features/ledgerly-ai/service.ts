import type { Runtime } from "../../runtime.js";
import { parseLedgerlyAiConfig, type LedgerlyAiConfig } from "./config.js";
import { createLedgerlyAiLogger } from "./logger.js";

export type LedgerlyAiHealth = {
  name: "Ledgerly AI";
  enabled: boolean;
  status: "ok" | "degraded" | "disabled";
  ready: boolean;
  startedAt: string;
  checkedAt: string;
  components: {
    config: { status: "ok" | "error" };
    postgres: { status: "ok" | "error"; latencyMs: number; error?: string };
    schema: { status: "ok" | "error"; latencyMs: number; error?: string };
  };
};

export class LedgerlyAiFoundationService {
  readonly config: LedgerlyAiConfig;
  readonly startedAt = new Date().toISOString();
  private readonly logger;

  constructor(
    private readonly runtime: Runtime,
    env: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
  ) {
    this.config = parseLedgerlyAiConfig(env);
    this.logger = createLedgerlyAiLogger(runtime.logger);
    this.logger.info(
      {
        enabled: this.config.LEDGERLY_AI_ENABLED,
        maxConcurrency: this.config.LEDGERLY_AI_MAX_CONCURRENCY,
        startupHealthcheck: this.config.LEDGERLY_AI_STARTUP_HEALTHCHECK,
      },
      "Ledgerly AI foundation initialized",
    );
  }

  start() {
    if (!this.config.LEDGERLY_AI_STARTUP_HEALTHCHECK) return;
    void this.health()
      .then((health) => {
        if (health.ready) this.logger.info({ health }, "Ledgerly AI startup health check passed");
        else this.logger.warn({ health }, "Ledgerly AI startup health check is degraded");
      })
      .catch((error) => this.logger.error({ err: error }, "Ledgerly AI startup health check failed"));
  }

  async health(): Promise<LedgerlyAiHealth> {
    const disabled = !this.config.LEDGERLY_AI_ENABLED;
    const postgresStarted = performance.now();
    let postgres: LedgerlyAiHealth["components"]["postgres"];
    try {
      await this.runtime.db.query("SELECT 1");
      postgres = { status: "ok", latencyMs: Math.round(performance.now() - postgresStarted) };
    } catch (error) {
      postgres = {
        status: "error",
        latencyMs: Math.round(performance.now() - postgresStarted),
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const schemaStarted = performance.now();
    let schema: LedgerlyAiHealth["components"]["schema"];
    try {
      const result = await this.runtime.db.query<{ chats: string | null; audit: string | null }>(
        "SELECT to_regclass('public.lai_chats')::text AS chats, to_regclass('public.lai_audit_events')::text AS audit",
      );
      const row = result.rows[0];
      if (!row?.chats || !row.audit) {
        schema = {
          status: "error",
          latencyMs: Math.round(performance.now() - schemaStarted),
          error: "Ledgerly AI database migration is not applied.",
        };
      } else {
        schema = { status: "ok", latencyMs: Math.round(performance.now() - schemaStarted) };
      }
    } catch (error) {
      schema = {
        status: "error",
        latencyMs: Math.round(performance.now() - schemaStarted),
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const ready = disabled ? false : postgres.status === "ok" && schema.status === "ok";
    return {
      name: "Ledgerly AI",
      enabled: !disabled,
      status: disabled ? "disabled" : ready ? "ok" : "degraded",
      ready,
      startedAt: this.startedAt,
      checkedAt: new Date().toISOString(),
      components: {
        config: { status: "ok" },
        postgres,
        schema,
      },
    };
  }
}
