import type { LedgerlyAiConfig } from "../config.js";
import path from "node:path";
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

export class CodexCliProvider implements LedgerlyAiProviderAdapter {
  readonly id = "codex" as const;
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
    const sandbox = request.sandbox ?? "read-only";
    const base = ["exec", "--skip-git-repo-check", "--json", "--sandbox", sandbox];
    if (!request.workspacePath) throw new Error("Ledgerly AI workspace is required.");
    const workspace = path.resolve(request.workspacePath);
    for (const imagePath of request.imagePaths ?? []) {
      const resolved = path.resolve(imagePath);
      const relative = path.relative(workspace, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Ledgerly AI image escaped the configured workspace.");
      }
      const providerImagePath = this.config.LEDGERLY_AI_EXECUTION_MODE === "docker"
        ? path.posix.join("/workspace", relative.split(path.sep).join(path.posix.sep))
        : resolved;
      // Use the equals form because Codex's variadic --image option otherwise
      // consumes the positional prompt as an additional image path.
      base.push(`--image=${providerImagePath}`);
    }
    const args = request.sessionId
      ? [...base, "resume", request.sessionId, request.prompt]
      : [...base, request.prompt];
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
    if (result.exitCode !== 0) throw new Error(result.stderrLines.at(-1) || "Ledgerly AI provider execution failed.");

    let text = "";
    let sessionId = request.sessionId;
    let usage: Record<string, unknown> | undefined;
    for (const event of result.events) {
      if (!event.data || typeof event.data !== "object") continue;
      const data = event.data as Record<string, unknown>;
      if (data.type === "thread.started" && typeof data.thread_id === "string") sessionId = data.thread_id;
      if (data.type === "turn.completed" && data.usage && typeof data.usage === "object") usage = data.usage as Record<string, unknown>;
      if (data.type === "item.completed" && data.item && typeof data.item === "object") {
        const item = data.item as Record<string, unknown>;
        if (item.type === "agent_message" && typeof item.text === "string") text = item.text;
      }
    }
    if (!text) text = result.stdoutLines.at(-1) ?? "";
    return { provider: this.id, text, sessionId, durationMs: result.durationMs, exitCode: result.exitCode, events: result.events, usage };
  }
}
