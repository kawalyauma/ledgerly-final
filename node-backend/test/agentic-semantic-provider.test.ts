import { describe, expect, it } from "vitest";
import { AGENTS } from "../src/features/agentic-employees/policy.js";
import { openAiTools } from "../src/features/agentic-employees/memory-tools-v17.js";
import { buildDraftSlots } from "../src/features/agentic-employees/semantic-tools.js";
import {
  LEDGERLY_AI_PROVIDERS,
  parseLedgerlyAiConfig,
} from "../src/features/ledgerly-ai/config.js";

describe("agentic semantic runtime", () => {
  it("actually exposes the semantic tools to an AI employee", () => {
    const tools = openAiTools(AGENTS.headteacher);
    const names = tools.map((tool: any) => tool.name);
    expect(names).toContain("semantic_capabilities");
    expect(names).toContain("resolve_entity");
    expect(names).toContain("get_related_entities");
    expect(names).toContain("query_metrics");
    expect(names).toContain("plan_timetable");
    expect(new Set(names).size).toBe(names.length);
  });

  it("bootstraps safe timetable slots without placing lessons through breaks", () => {
    const draft = buildDraftSlots({});
    expect(draft.schoolStart).toBe("08:00");
    expect(draft.schoolEnd).toBe("16:00");
    expect(draft.periodMinutes).toBe(40);
    expect(draft.slots.length).toBeGreaterThan(0);
    expect(draft.slots.some(slot => slot.start === "10:00")).toBe(false);
    expect(draft.slots.some(slot => slot.start === "12:20")).toBe(false);
    for (const slot of draft.slots) {
      expect(!(slot.start < "10:20" && slot.end > "10:00")).toBe(true);
      expect(!(slot.start < "13:20" && slot.end > "12:20")).toBe(true);
    }
  });
});

describe("Agentic Employees managed Ledgerly AI provider policy", () => {
  it("uses only the two Ledgerly AI CLI execution providers", () => {
    expect(LEDGERLY_AI_PROVIDERS).toEqual(["codex", "claude-code"]);
    const config = parseLedgerlyAiConfig({});
    expect(config.LEDGERLY_AI_DEFAULT_PROVIDER).toBe("codex");
    expect(config.LEDGERLY_AI_FALLBACK_PROVIDER).toBe("claude-code");
  });

  it("keeps employee model tiers as routing hints rather than public providers", () => {
    expect(AGENTS.secretary.modelTier).toBe("luna");
    expect(AGENTS.dos.modelTier).toBe("terra");
    expect(AGENTS.headteacher.modelTier).toBe("sol");
    expect(LEDGERLY_AI_PROVIDERS).not.toContain("openai" as never);
    expect(LEDGERLY_AI_PROVIDERS).not.toContain("ollama" as never);
  });
});
