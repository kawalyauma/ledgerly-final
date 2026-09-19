import { describe, expect, it } from "vitest";
import {
  LEDGERLY_AI_PROVIDERS,
  parseLedgerlyAiConfig,
} from "../src/features/ledgerly-ai/config.js";
import { createLedgerlyAiCorrelationId } from "../src/features/ledgerly-ai/logger.js";

describe("Ledgerly AI foundation", () => {
  it("allows only Codex CLI and Claude Code CLI provider identities", () => {
    expect(LEDGERLY_AI_PROVIDERS).toEqual(["codex", "claude-code"]);
  });

  it("uses safe provider defaults without exposing API providers", () => {
    const config = parseLedgerlyAiConfig({});
    expect(config.LEDGERLY_AI_ENABLED).toBe(true);
    expect(config.LEDGERLY_AI_DEFAULT_PROVIDER).toBe("codex");
    expect(config.LEDGERLY_AI_FALLBACK_PROVIDER).toBe("claude-code");
    expect(config.LEDGERLY_AI_LOG_PROMPTS).toBe(false);
  });

  it("rejects unsupported providers", () => {
    expect(() =>
      parseLedgerlyAiConfig({
        LEDGERLY_AI_DEFAULT_PROVIDER: "openai",
        LEDGERLY_AI_FALLBACK_PROVIDER: "claude-code",
      }),
    ).toThrow(/LEDGERLY_AI_DEFAULT_PROVIDER/);
  });

  it("requires default and fallback providers to differ", () => {
    expect(() =>
      parseLedgerlyAiConfig({
        LEDGERLY_AI_DEFAULT_PROVIDER: "codex",
        LEDGERLY_AI_FALLBACK_PROVIDER: "codex",
      }),
    ).toThrow(/Fallback provider must differ/);
  });

  it("creates traceable Ledgerly AI correlation IDs", () => {
    expect(createLedgerlyAiCorrelationId()).toMatch(/^lai_[a-f0-9]{32}$/);
  });
});
