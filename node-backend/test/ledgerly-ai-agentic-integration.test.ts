import { describe, expect, it } from "vitest";
import { AGENTS } from "../src/features/agentic-employees/policy.js";
import { runAgent } from "../src/features/agentic-employees/openai.js";
import { createLegacyEmployeeDelegationTool } from "../src/features/agentic-employees/ledgerly-ai-tool.js";
import type { AuthPrincipal } from "../src/http/types.js";
import type { LedgerlyAiEmployee } from "../src/features/ledgerly-ai/employees/types.js";

const principal: AuthPrincipal = {
  userId: "usr_1",
  organizationId: "org_1",
  role: "manager",
  scopes: ["school:read"],
};

describe("Ledgerly AI Agentic Employees integration", () => {
  it("preserves the six existing employee identities", () => {
    expect(AGENTS.secretary.name).toBe("Amina");
    expect(AGENTS.dos.name).toBe("Daniel");
    expect(AGENTS.bursar.name).toBe("Grace");
    expect(AGENTS.headteacher.name).toBe("Mirembe");
    expect(AGENTS.hr.name).toBe("Sarah");
    expect(AGENTS.librarian.name).toBe("Peter");
  });

  it("requires the shared Ledgerly AI bridge for legacy model execution", async () => {
    await expect(runAgent({
      db: {} as never,
      env: {} as never,
      principal,
      agent: AGENTS.secretary,
      modelTier: "luna",
      conversationId: "aac_1",
      messages: [{ role: "user", content: "Hello" }],
    })).rejects.toMatchObject({ code: "LEDGERLY_AI_UNAVAILABLE" });
  });

  it("keeps Amani as the only caller of the central legacy delegation tool", async () => {
    let delegated = false;
    const bridge = {
      async delegateFromAmani() {
        delegated = true;
        return { response: "ok" };
      },
    };
    const tool = createLegacyEmployeeDelegationTool(bridge as never, {} as never, {} as never);
    const nonAmani: LedgerlyAiEmployee = {
      id: "laiagt_elimu",
      organizationId: "org_1",
      key: "elimu",
      name: "Elimu",
      role: "Academic Analyst",
      description: "",
      icon: null,
      avatar: {},
      visibility: "staff",
      permissions: ["school:read"],
      effectivePermissions: ["school:read"],
      capabilities: [],
      tools: ["agent.delegate.legacy"],
      memoryScope: "organization",
      status: "active",
      kind: "built-in",
      templateVersion: 1,
      metadata: {},
    };

    await expect(tool.execute({
      runtime: {} as never,
      config: {} as never,
      principal,
      employee: nonAmani,
      correlationId: "corr_1",
    }, { employee: "secretary", request: "Check learner records" }))
      .rejects.toThrow(/reserved for Amani/);
    expect(delegated).toBe(false);
  });

  it("accepts only the six legacy employee keys as central delegation targets", () => {
    const tool = createLegacyEmployeeDelegationTool({} as never, {} as never, {} as never);
    const schema = tool.inputSchema.safeParse({ employee: "kato", request: "Inspect this" });
    expect(schema.success).toBe(false);
    for (const employee of ["secretary","dos","bursar","headteacher","hr","librarian"]) {
      expect(tool.inputSchema.safeParse({ employee, request: "Read the relevant records" }).success).toBe(true);
    }
  });
});
