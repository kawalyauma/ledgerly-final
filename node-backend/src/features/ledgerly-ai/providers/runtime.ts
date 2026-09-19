import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Runtime } from "../../runtime.js";
import type { LedgerlyAiConfig, LedgerlyAiProviderId } from "../config.js";
import { createLedgerlyAiCorrelationId, createLedgerlyAiLogger } from "../logger.js";
import { ClaudeCodeCliProvider } from "./claude-code.js";
import { ProviderCommandBuilder } from "./command-builder.js";
import { CodexCliProvider } from "./codex.js";
import { LedgerlyAiExecutionQueue } from "./execution-queue.js";
import { LedgerlyAiProviderRouter } from "./router.js";
import { ProviderSessionStore } from "./session.js";
import type { ProviderRequest, ProviderResult } from "./types.js";

export class LedgerlyAiProviderRuntime {
  readonly sessions: ProviderSessionStore;
  readonly queue: LedgerlyAiExecutionQueue;
  readonly router: LedgerlyAiProviderRouter;
  private readonly providers: Map<LedgerlyAiProviderId, CodexCliProvider | ClaudeCodeCliProvider>;
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly logger;

  constructor(
    private readonly runtime: Runtime,
    readonly config: LedgerlyAiConfig,
  ) {
    this.sessions = new ProviderSessionStore(config);
    const commands = new ProviderCommandBuilder(config, this.sessions);
    this.providers = new Map([
      ["codex", new CodexCliProvider(config, this.sessions, commands)],
      ["claude-code", new ClaudeCodeCliProvider(config, this.sessions, commands)],
    ]);
    this.queue = new LedgerlyAiExecutionQueue(config.LEDGERLY_AI_MAX_CONCURRENCY, config.LEDGERLY_AI_MAX_QUEUE);
    this.router = new LedgerlyAiProviderRouter(runtime.db, config, this.providers, () => ({
      active: this.queue.active,
      queued: this.queue.queued,
    }));
    this.logger = createLedgerlyAiLogger(runtime.logger);
  }

  async initialize() {
    await this.sessions.initialize();
  }

  async diagnostics() {
    return this.router.diagnostics();
  }

  cancel(executionId: string) {
    if (this.queue.cancelQueued(executionId)) return true;
    const controller = this.activeControllers.get(executionId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  execute(request: ProviderRequest): Promise<ProviderResult> {
    return this.queue.submit(request.id, async () => {
      const workspacePath = path.resolve(request.workspacePath ?? path.join(this.config.LEDGERLY_AI_WORK_ROOT, request.id));
      await mkdir(workspacePath, { recursive: true, mode: 0o700 });
      const controller = new AbortController();
      this.activeControllers.set(request.id, controller);
      const candidates = await this.router.rank(request.taskKind);
      const failures: Array<{ provider: LedgerlyAiProviderId; error: string }> = [];
      try {
        for (const providerId of candidates) {
          const provider = this.providers.get(providerId);
          if (!provider) continue;
          const attempts = this.config.LEDGERLY_AI_RETRY_ATTEMPTS + 1;
          for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const executionId = createLedgerlyAiCorrelationId("laix");
            await this.runtime.db.query(
              `INSERT INTO lai_provider_executions(
                id,organization_id,job_id,provider_internal,status,correlation_id,started_at,metadata_json
              ) VALUES($1,$2,$3,$4,'running',$5,CURRENT_TIMESTAMP,$6::jsonb)`,
              [executionId, request.organizationId, request.id, providerId, request.correlationId, JSON.stringify({ taskKind: request.taskKind, attempt })],
            );
            try {
              const result = await provider.execute({ ...request, workspacePath }, controller.signal);
              await this.runtime.db.query(
                `UPDATE lai_provider_executions
                    SET status='succeeded',exit_code=$1,completed_at=CURRENT_TIMESTAMP,
                        metadata_json=metadata_json || $2::jsonb
                  WHERE id=$3`,
                [result.exitCode, JSON.stringify({ durationMs: result.durationMs, sessionId: result.sessionId ?? null, usage: result.usage ?? null }), executionId],
              );
              this.logger.info(
                { providerInternal: providerId, executionId, jobId: request.id, durationMs: result.durationMs },
                "Ledgerly AI provider execution succeeded",
              );
              return result;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              failures.push({ provider: providerId, error: message });
              await this.runtime.db.query(
                `UPDATE lai_provider_executions
                    SET status=$1,error_text=$2,completed_at=CURRENT_TIMESTAMP
                  WHERE id=$3`,
                [controller.signal.aborted ? "cancelled" : "failed", message.slice(0, 4000), executionId],
              );
              this.logger.warn(
                { providerInternal: providerId, executionId, jobId: request.id, attempt, err: message },
                "Ledgerly AI provider execution failed",
              );
              if (controller.signal.aborted) throw error;
              if (attempt < attempts && this.config.LEDGERLY_AI_RETRY_BACKOFF_MS > 0) {
                await new Promise((resolve) => setTimeout(resolve, this.config.LEDGERLY_AI_RETRY_BACKOFF_MS * attempt));
              }
            }
          }
        }
        throw new Error(`Ledgerly AI could not complete the request after provider failover. ${failures.map((failure) => failure.error).join(" | ")}`);
      } finally {
        this.activeControllers.delete(request.id);
      }
    });
  }
}
