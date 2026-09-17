import { describe, expect, it } from "vitest";
import { AGENTS } from "../src/features/agentic-employees/policy.js";
import { openAiTools } from "../src/features/agentic-employees/memory-tools-v17.js";
import { buildDraftSlots } from "../src/features/agentic-employees/semantic-tools.js";
import { AI_PROVIDER_CATALOG, normalizeAdvancedConfig, normalizeModels } from "../src/features/agentic-employees/provider-config.js";

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

describe("agentic provider abstraction", () => {
  it("supports switchable cloud, local and future compatible providers", () => {
    expect(Object.keys(AI_PROVIDER_CATALOG).sort()).toEqual([
      "anthropic", "cloudflare", "custom", "google", "groq", "ollama", "openai", "openrouter",
    ]);
    expect(AI_PROVIDER_CATALOG.openai.apiStyle).toBe("responses");
    expect(AI_PROVIDER_CATALOG.anthropic.apiStyle).toBe("anthropic");
    for (const provider of ["groq", "google", "cloudflare", "openrouter", "ollama", "custom"] as const) {
      expect(AI_PROVIDER_CATALOG[provider].apiStyle).toBe("chat-completions");
    }
    expect(AI_PROVIDER_CATALOG.ollama.apiKeyRequired).toBe(false);
    expect(AI_PROVIDER_CATALOG.custom.apiKeyRequired).toBe(false);
  });

  it("allows provider-specific model IDs and custom/local endpoints", () => {
    expect(normalizeModels("groq", { sol: "openai/gpt-oss-120b" }).sol).toBe("openai/gpt-oss-120b");
    expect(normalizeModels("ollama", { luna: "qwen3:8b" }).luna).toBe("qwen3:8b");
    expect(normalizeModels("custom", { terra: "my-company/model-v2" }).terra).toBe("my-company/model-v2");
    expect(normalizeAdvancedConfig({ baseUrl: "http://192.168.1.20:11434/v1" }).baseUrl).toBe("http://192.168.1.20:11434/v1");
  });
});
