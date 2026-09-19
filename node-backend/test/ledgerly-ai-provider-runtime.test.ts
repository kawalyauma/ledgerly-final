import { describe, expect, it } from "vitest";
import { parseLedgerlyAiConfig } from "../src/features/ledgerly-ai/config.js";
import {
  LedgerlyAiExecutionQueue,
  LedgerlyAiQueueFullError,
} from "../src/features/ledgerly-ai/providers/execution-queue.js";
import { sanitizeLedgerlyAiPublicText } from "../src/features/ledgerly-ai/providers/public-output.js";

describe("Ledgerly AI provider runtime", () => {
  it("defaults to Docker-isolated CLI execution", () => {
    const config = parseLedgerlyAiConfig({});
    expect(config.LEDGERLY_AI_EXECUTION_MODE).toBe("docker");
    expect(config.LEDGERLY_AI_CODEX_IMAGE).toBe("ledgerly-ai-codex:local");
    expect(config.LEDGERLY_AI_CLAUDE_IMAGE).toBe("ledgerly-ai-claude-code:local");
  });

  it("removes hidden provider identities from public text", () => {
    expect(sanitizeLedgerlyAiPublicText("Codex CLI completed this and Claude Code reviewed it."))
      .toBe("Ledgerly AI completed this and Ledgerly AI reviewed it.");
  });

  it("enforces queue backpressure", async () => {
    const queue = new LedgerlyAiExecutionQueue(1, 1);
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.submit("first", async () => blocker);
    const second = queue.submit("second", async () => "second");
    await expect(queue.submit("third", async () => "third")).rejects.toBeInstanceOf(LedgerlyAiQueueFullError);
    release();
    await first;
    await expect(second).resolves.toBe("second");
  });

  it("rejects non-Ledgerly providers at configuration time", () => {
    expect(() => parseLedgerlyAiConfig({
      LEDGERLY_AI_DEFAULT_PROVIDER: "openai",
      LEDGERLY_AI_FALLBACK_PROVIDER: "claude-code",
    })).toThrow();
  });
});
