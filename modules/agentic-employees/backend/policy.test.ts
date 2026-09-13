import { describe, expect, it } from "vitest";
import { AGENTS, actionNeedsApproval, allowedTools, isToolAllowed, resolveModel } from "./policy";

describe("agentic employee policy", () => {
  it("never expands an employee tool allowlist from tenant configuration", () => {
    expect(allowedTools(AGENTS.secretary, ["search_students", "fee_arrears_summary", "unknown"])).toEqual(["search_students"]);
    expect(isToolAllowed(AGENTS.secretary, "fee_arrears_summary", ["fee_arrears_summary"])).toBe(false);
  });

  it("keeps sensitive actions behind approval", () => {
    expect(actionNeedsApproval("communication.send")).toBe(true);
    expect(actionNeedsApproval("finance.write")).toBe(true);
    expect(actionNeedsApproval("school_snapshot")).toBe(false);
  });

  it("uses explicit model IDs with server environment overrides", () => {
    expect(resolveModel("luna", {})).toBe("gpt-5.6-luna");
    expect(resolveModel("sol", { OPENAI_MODEL_SOL: "custom-sol" })).toBe("custom-sol");
  });

  it("separates employee responsibilities", () => {
    expect(AGENTS.bursar.tools).toContain("fee_balance_lookup");
    expect(AGENTS.dos.tools).not.toContain("fee_balance_lookup");
    expect(AGENTS.headteacher.modelTier).toBe("sol");
  });
});
