import { describe, expect, it } from "vitest";
import { parseLedgerlyAiConfig } from "../src/features/ledgerly-ai/config.js";
import { LedgerlyAiMemoryService } from "../src/features/ledgerly-ai/memory/service.js";
import {
  LEDGERLY_AI_MEMORY_KINDS,
  LEDGERLY_AI_MEMORY_SCOPES,
  type LedgerlyAiMemoryRecord,
} from "../src/features/ledgerly-ai/memory/types.js";

describe("Ledgerly AI memory", () => {
  it("supports every required memory scope and memory kind", () => {
    expect(LEDGERLY_AI_MEMORY_SCOPES).toEqual(["chat", "user", "agent", "organization", "project"]);
    expect(LEDGERLY_AI_MEMORY_KINDS).toContain("operational");
    expect(LEDGERLY_AI_MEMORY_KINDS).toContain("preference");
    expect(LEDGERLY_AI_MEMORY_KINDS).toContain("summary");
  });

  it("uses bounded memory defaults", () => {
    const config = parseLedgerlyAiConfig({});
    expect(config.LEDGERLY_AI_SHORT_TERM_MEMORY_DAYS).toBe(7);
    expect(config.LEDGERLY_AI_MEMORY_RETRIEVAL_LIMIT).toBe(12);
    expect(config.LEDGERLY_AI_MEMORY_CONTEXT_CHARS).toBe(12000);
  });

  it("formats memory context with provenance and confidence", () => {
    const config = parseLedgerlyAiConfig({ LEDGERLY_AI_MEMORY_CONTEXT_CHARS: 2000 });
    const service = new LedgerlyAiMemoryService({} as never, {} as never, config);
    const memory: LedgerlyAiMemoryRecord = {
      id: "mem_1",
      organizationId: "org_1",
      scopeType: "user",
      scopeId: "usr_1",
      kind: "preference",
      title: "Reporting preference",
      content: "Prefers concise school finance summaries.",
      importance: 0.8,
      confidence: 0.9,
      sourceType: "manual",
      sourceId: "msg_1",
      requiredScope: null,
      pinned: true,
      correctionOfId: null,
      status: "active",
      metadata: {},
      expiresAt: null,
      lastUsedAt: null,
      useCount: 0,
      createdBy: "usr_1",
      updatedBy: "usr_1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const context = service.formatForContext([memory]);
    expect(context).toContain("preference");
    expect(context).toContain("scope=user");
    expect(context).toContain("confidence=0.90");
    expect(context).toContain("source=manual:msg_1");
    expect(context).toContain(memory.content);
  });

  it("never exceeds the configured memory context budget by more than its first header", () => {
    const config = parseLedgerlyAiConfig({ LEDGERLY_AI_MEMORY_CONTEXT_CHARS: 1000 });
    const service = new LedgerlyAiMemoryService({} as never, {} as never, config);
    const base: LedgerlyAiMemoryRecord = {
      id: "mem_1",
      organizationId: "org_1",
      scopeType: "organization",
      scopeId: "org_1",
      kind: "operational",
      title: null,
      content: "x".repeat(5000),
      importance: 1,
      confidence: 1,
      sourceType: "system",
      sourceId: null,
      requiredScope: null,
      pinned: false,
      correctionOfId: null,
      status: "active",
      metadata: {},
      expiresAt: null,
      lastUsedAt: null,
      useCount: 0,
      createdBy: "usr_1",
      updatedBy: "usr_1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const context = service.formatForContext([base, { ...base, id: "mem_2" }]);
    expect(context.length).toBeLessThanOrEqual(1000);
  });
});
