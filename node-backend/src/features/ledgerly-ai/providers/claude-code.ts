import type { LedgerlyAiConfig } from "../config.js";
import { ProviderCommandBuilder } from "./command-builder.js";
import { runProviderProcess } from "./process-runner.js";
import { ProviderSessionStore } from "./session.js";
import type {
  LedgerlyAiProviderAdapter,
  LedgerlyAiTaskKind,
  ProviderHealth,
  ProviderRequest,
  ProviderResult,
} from "./types.js";

const capabilities = new Set<LedgerlyAiTaskKind>([
  "chat", "analysis", "report", "research", "code", "engineering", "testing", "operations",
]);

export class ClaudeCodeCliProvider implements LedgerlyAiProviderAdapter {
  readonly id = "claude-code" as const;
  readonly capabilities = capabilities;

  constructor(
    private readonly config: LedgerlyAiConfig,
    private readonly sessions: ProviderSessionStore,
    private readonly commands: ProviderCommandBuilder,
  ) {}

  async health(): Promise<ProviderHealth> {
    const started = Date.now();
    const sessionConfigured = await this.sessions.configured(this.id);
    try {
      const command = this.commands.health(this.id);
      const result = await runProviderProcess({
        ...command,
        timeoutMs: this.config.LEDGERLY_AI_HEALTH_TIMEOUT_MS,
        maxOutputBytes: 64 * 1024,
      });
      return {
        provider: this.id,
        available: result.exitCode === 0 && sessionConfigured,
        executable: result.exitCode === 0,
        sessionConfigured,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        detail: result.exitCode === 0 ? "CLI executable is available." : "CLI version check failed.",
      };
    } catch (error) {
      return {
        provider: this.id,
        available: false,
        executable: false,
        sessionConfigured,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async execute(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult> {
    if (request.imagePaths?.length) {
      throw new Error("Claude Code CLI does not support native local image attachments; use an image-capable provider.");
    }
    const sandbox = request.sandbox ?? "read-only";
    const args = [
      "-p", request.prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--max-turns", String(request.maxTurns ?? 12),
    ];
    if (request.sessionId) args.push("--resume", request.sessionId);
    if (sandbox === "read-only") args.push("--permission-mode", "plan");
    if (sandbox === "workspace-write") args.push("--dangerously-skip-permissions");
    if (!request.workspacePath) throw new Error("Ledgerly AI workspace is required.");

    const command = this.commands.build(this.id, args, request.workspacePath, sandbox);
    const result = await runProviderProcess({
      ...command,
      timeoutMs: request.timeoutMs ?? this.config.LEDGERLY_AI_JOB_TIMEOUT_MS,
      maxOutputBytes: this.config.LEDGERLY_AI_MAX_OUTPUT_BYTES,
      signal,
      onEvent:request.onEvent,
    });
    if (result.timedOut) throw new Error("Ledgerly AI provider execution timed out.");
    if (result.aborted) throw new Error("Ledgerly AI provider execution was cancelled.");
    if (result.exitCode !== 0) {
      throw new Error(result.stderrLines.at(-1) || "Ledgerly AI provider execution failed.");
    }

    let text = "";
    let sessionId = request.sessionId;
    let usage: Record<string, unknown> | undefined;
    for (const event of result.events) {
      if (!event.data || typeof event.data !== "object") continue;
      const data = event.data as Record<string, unknown>;
      if (typeof data.session_id === "string") sessionId = data.session_id;
      if (data.type === "result") {
        if (typeof data.result === "string") text = data.result;
        const candidate: Record<string, unknown> = {};
        for (const key of ["total_cost_usd", "duration_ms", "duration_api_ms", "num_turns"]) {
          if (data[key] !== undefined) candidate[key] = data[key];
        }
        if (Object.keys(candidate).length) usage = candidate;
      }
    }
    if (!text) text = result.stdoutLines.at(-1) ?? "";
    return { provider: this.id, text, sessionId, durationMs: result.durationMs, exitCode: result.exitCode, events: result.events, usage };
  }
}
