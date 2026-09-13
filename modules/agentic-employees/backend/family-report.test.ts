import { describe, expect, it } from "vitest";
import { AGENTS } from "./policy";
import { normalizeGuardianQuery } from "./family-resolver";
import { openAiTools } from "./tools-v125b";

describe("agentic family reporting", () => {
  it("normalizes common guardian honorifics without changing the family name", () => {
    expect(normalizeGuardianQuery("Mr. Mukasa")).toBe("Mukasa");
    expect(normalizeGuardianQuery("  Dr Nakato   Sarah ")).toBe("Nakato Sarah");
  });

  it("exposes family reporting and delegation to DOS on the inherited default toolset", () => {
    const names = openAiTools(AGENTS.dos, [...AGENTS.dos.tools]).map(tool => tool.name);
    expect(names).toContain("resolve_guardian_family");
    expect(names).toContain("family_comprehensive_report");
    expect(names).toContain("delegate_to_employee");
  });

  it("does not expose cross-employee delegation to the bursar", () => {
    const names = openAiTools(AGENTS.bursar, [...AGENTS.bursar.tools]).map(tool => tool.name);
    expect(names).not.toContain("delegate_to_employee");
    expect(names).not.toContain("family_comprehensive_report");
  });

  it("keeps genuinely customized DOS toolsets restrictive", () => {
    const names = openAiTools(AGENTS.dos, ["school_snapshot", "lesson_plan_queue"]).map(tool => tool.name);
    expect(names).not.toContain("family_comprehensive_report");
    expect(names).not.toContain("delegate_to_employee");
  });

  it("uses non-strict tool mode until legacy optional schemas are fully nullable-required", () => {
    const tools = openAiTools(AGENTS.dos, [...AGENTS.dos.tools]);
    expect(tools.every(tool => tool.strict === false)).toBe(true);
  });
});
