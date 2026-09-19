import { describe, expect, it } from "vitest";
import { parseLedgerlyAiConfig } from "../src/features/ledgerly-ai/config.js";
import { normalizeLedgerlyAiResponse } from "../src/features/ledgerly-ai/gateway/normalize.js";
import { redactLedgerlyAiText, redactLedgerlyAiValue } from "../src/features/ledgerly-ai/gateway/redaction.js";

describe("Ledgerly AI gateway", () => {
  it("has bounded user, organization and agent request defaults", () => {
    const config = parseLedgerlyAiConfig({});
    expect(config.LEDGERLY_AI_USER_REQUESTS_PER_MINUTE).toBe(20);
    expect(config.LEDGERLY_AI_ORG_REQUESTS_PER_MINUTE).toBe(200);
    expect(config.LEDGERLY_AI_AGENT_REQUESTS_PER_MINUTE).toBe(60);
  });

  it("redacts secrets from diagnostic text and metadata", () => {
    const text = redactLedgerlyAiText("Authorization: Bearer abc.def.ghi password=hunter2");
    expect(text).not.toContain("abc.def.ghi");
    expect(text).not.toContain("hunter2");
    expect(redactLedgerlyAiValue({ apiKey: "secret-value", nested: { token: "token-value" } }))
      .toEqual({ apiKey: "[REDACTED]", nested: { token: "[REDACTED]" } });
  });

  it("normalizes hidden-provider output into a provider-neutral response", () => {
    const normalized = normalizeLedgerlyAiResponse({
      provider: "codex",
      text: "I am Codex CLI and I completed the analysis.",
      durationMs: 120,
      exitCode: 0,
      events: [],
      sessionId: "provider-private-session",
    });
    expect(normalized.content).toBe("I am Ledgerly AI and I completed the analysis.");
    expect(normalized).not.toHaveProperty("provider");
    expect(normalized).not.toHaveProperty("sessionId");
  });
});
