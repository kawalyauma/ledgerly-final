import { describe, expect, it } from "vitest";
import { parseLedgerlyAiConfig } from "../src/features/ledgerly-ai/config.js";
import {
  LedgerlyAiExecutionQueue,
  LedgerlyAiQueueFullError,
} from "../src/features/ledgerly-ai/providers/execution-queue.js";
import { sanitizeLedgerlyAiPublicText } from "../src/features/ledgerly-ai/providers/public-output.js";
import { humanizeLedgerlyAiProviderEvent } from "../src/features/ledgerly-ai/providers/readable-events.js";

describe("Ledgerly AI provider runtime", () => {
  it("defaults to Docker-isolated CLI execution", () => {
    const config = parseLedgerlyAiConfig({});
    expect(config.LEDGERLY_AI_EXECUTION_MODE).toBe("docker");
    expect(config.LEDGERLY_AI_CODEX_IMAGE).toBe("ledgerly-ai-codex:local");
    expect(config.LEDGERLY_AI_CLAUDE_IMAGE).toBe("ledgerly-ai-claude-code:local");
  });

  it("hides runtime identity disclosures without censoring ordinary product discussion", () => {
    expect(sanitizeLedgerlyAiPublicText("I am Codex CLI and this was reviewed by Claude Code."))
      .toBe("I am Ledgerly AI and this was reviewed by Ledgerly AI.");
    expect(sanitizeLedgerlyAiPublicText("Explain what Claude Code and Codex are."))
      .toBe("Explain what Claude Code and Codex are.");
  });

  it("turns provider streams into readable employee updates", () => {
    const claude=humanizeLedgerlyAiProviderEvent({
      at:new Date().toISOString(),stream:"stdout",type:"assistant",
      data:{type:"assistant",message:{content:[{type:"text",text:"I found the dashboard component. I’m updating it now."}]}},
    });
    expect(claude?.content).toContain("I found the dashboard component");

    const tool=humanizeLedgerlyAiProviderEvent({
      at:new Date().toISOString(),stream:"stdout",type:"assistant",
      data:{type:"assistant",message:{content:[{type:"tool_use",name:"Bash",input:{command:"git diff --check"}}]}},
    });
    expect(tool?.content).toBe("I’m checking the Git changes now.");

    const codex=humanizeLedgerlyAiProviderEvent({
      at:new Date().toISOString(),stream:"stdout",type:"item.started",
      data:{type:"item.started",item:{type:"command_execution",command:"npm test"}},
    });
    expect(codex?.content).toBe("I’m running the relevant tests now.");

    const internal=humanizeLedgerlyAiProviderEvent({
      at:new Date().toISOString(),stream:"stdout",type:"assistant",
      data:{type:"assistant",message:{content:[{type:"text",text:"[[LEDGERLY_TOOL_CALL]]{\"name\":\"school.search\",\"arguments\":{}}[[/LEDGERLY_TOOL_CALL]]"}]}},
    });
    expect(internal).toBeNull();
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
