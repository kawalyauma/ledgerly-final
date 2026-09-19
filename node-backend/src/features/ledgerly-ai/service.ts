import type { Runtime } from "../../runtime.js";
import { parseLedgerlyAiConfig, type LedgerlyAiConfig } from "./config.js";
import { LedgerlyAiGatewayRepository } from "./gateway/repository.js";
import { LedgerlyAiGatewayService } from "./gateway/service.js";
import { createLedgerlyAiLogger, type LedgerlyAiLogger } from "./logger.js";
import { LedgerlyAiMemoryService } from "./memory/service.js";
import { LedgerlyAiProviderRuntime } from "./providers/runtime.js";

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
    providerPool: { status: "ok" | "error"; available: number; configured: number };
  };
};

export class LedgerlyAiFoundationService {
  readonly config: LedgerlyAiConfig;
  readonly startedAt = new Date().toISOString();
  readonly providers: LedgerlyAiProviderRuntime;
  readonly repository: LedgerlyAiGatewayRepository;
  readonly memory: LedgerlyAiMemoryService;
  readonly gateway: LedgerlyAiGatewayService;
  private readonly logger: LedgerlyAiLogger;

  constructor(
    private readonly runtime: Runtime,
    env: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
  ) {
    this.config = parseLedgerlyAiConfig(env);
    this.logger = createLedgerlyAiLogger(runtime.logger);
    this.providers = new LedgerlyAiProviderRuntime(runtime, this.config);
    this.repository = new LedgerlyAiGatewayRepository(runtime.db);
    this.memory = new LedgerlyAiMemoryService(runtime.db, this.repository, this.config);
    this.gateway = new LedgerlyAiGatewayService(
      this.repository,
      this.providers,
      this.memory,
      this.config,
      runtime.db,
      this.logger,
    );
    this.logger.info(
      {
        enabled: this.config.LEDGERLY_AI_ENABLED,
        executionMode: this.config.LEDGERLY_AI_EXECUTION_MODE,
        maxConcurrency: this.config.LEDGERLY_AI_MAX_CONCURRENCY,
        startupHealthcheck: this.config.LEDGERLY_AI_STARTUP_HEALTHCHECK,
      },
      "Ledgerly AI initialized",
    );
  }

  start() {
    void this.providers.initialize()
      .then(async () => {
        if (!this.config.LEDGERLY_AI_STARTUP_HEALTHCHECK) return;
        const health = await this.health();
        if (health.ready) this.logger.info({ health }, "Ledgerly AI startup health check passed");
        else this.logger.warn({ health }, "Ledgerly AI startup health check is degraded");
      })
      .catch((error) => this.logger.error({ err: error }, "Ledgerly AI startup failed"));
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
      const result = await this.runtime.db.query<{
        chats: string | null;
        audit: string | null;
        memories: string | null;
        memoryAudit: string | null;
      }>(
        `SELECT
           to_regclass('public.lai_chats')::text AS chats,
           to_regclass('public.lai_audit_events')::text AS audit,
           to_regclass('public.lai_memories')::text AS memories,
           to_regclass('public.lai_memory_audit')::text AS "memoryAudit"`,
      );
      const row = result.rows[0];
      schema = !row?.chats || !row.audit || !row.memories || !row.memoryAudit
        ? {
            status: "error",
            latencyMs: Math.round(performance.now() - schemaStarted),
            error: "Ledgerly AI database migrations are not fully applied.",
          }
        : { status: "ok", latencyMs: Math.round(performance.now() - schemaStarted) };
    } catch (error) {
      schema = {
        status: "error",
        latencyMs: Math.round(performance.now() - schemaStarted),
        error: error instanceof Error ? error.message : String(error),
      };
    }

    let providerPool: LedgerlyAiHealth["components"]["providerPool"];
    try {
      const diagnostics = await this.providers.diagnostics();
      const available = diagnostics.filter((item) => item.available).length;
      const configured = diagnostics.filter((item) => item.sessionConfigured).length;
      providerPool = { status: available > 0 ? "ok" : "error", available, configured };
    } catch {
      providerPool = { status: "error", available: 0, configured: 0 };
    }

    const ready = disabled ? false : postgres.status === "ok" && schema.status === "ok" && providerPool.status === "ok";
    return {
      name: "Ledgerly AI",
      enabled: !disabled,
      status: disabled ? "disabled" : ready ? "ok" : "degraded",
      ready,
      startedAt: this.startedAt,
      checkedAt: new Date().toISOString(),
      components: { config: { status: "ok" }, postgres, schema, providerPool },
    };
  }
}
