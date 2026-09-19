import { describe, expect, it } from "vitest";
import {
  BUILT_IN_EMPLOYEE_KEYS,
  BUILT_IN_EMPLOYEE_NAMES,
} from "../src/features/ledgerly-ai/employees/definitions.js";
import {
  builtInEmployeeId,
  LedgerlyAiEmployeeRegistry,
} from "../src/features/ledgerly-ai/employees/registry.js";
import type { LedgerlyAiEmployee } from "../src/features/ledgerly-ai/employees/types.js";

describe("Ledgerly AI named employees", () => {
  it("defines the complete built-in employee team", () => {
    expect(BUILT_IN_EMPLOYEE_KEYS).toEqual([
      "amani","kato","maya","tendo","nia","jabali","safi","elimu","hesabu","ripoti","kumbuka","forge",
    ]);
    expect(BUILT_IN_EMPLOYEE_NAMES.amani).toBe("Amani");
    expect(BUILT_IN_EMPLOYEE_NAMES.kato).toBe("Kato");
    expect(BUILT_IN_EMPLOYEE_NAMES.maya).toBe("Maya");
    expect(BUILT_IN_EMPLOYEE_NAMES.tendo).toBe("Tendo");
    expect(BUILT_IN_EMPLOYEE_NAMES.nia).toBe("Nia");
    expect(BUILT_IN_EMPLOYEE_NAMES.jabali).toBe("Jabali");
    expect(BUILT_IN_EMPLOYEE_NAMES.safi).toBe("Safi");
    expect(BUILT_IN_EMPLOYEE_NAMES.elimu).toBe("Elimu");
    expect(BUILT_IN_EMPLOYEE_NAMES.hesabu).toBe("Hesabu");
    expect(BUILT_IN_EMPLOYEE_NAMES.ripoti).toBe("Ripoti");
    expect(BUILT_IN_EMPLOYEE_NAMES.kumbuka).toBe("Kumbuka");
    expect(BUILT_IN_EMPLOYEE_NAMES.forge).toBe("Forge");
  });

  it("generates stable tenant-scoped built-in employee IDs", () => {
    expect(builtInEmployeeId("org_1", "amani")).toBe(builtInEmployeeId("org_1", "amani"));
    expect(builtInEmployeeId("org_1", "amani")).not.toBe(builtInEmployeeId("org_2", "amani"));
    expect(builtInEmployeeId("org_1", "amani")).not.toBe(builtInEmployeeId("org_1", "kato"));
  });

  it("builds a stable provider-neutral employee identity prompt", () => {
    const registry = new LedgerlyAiEmployeeRegistry({} as never);
    const employee: LedgerlyAiEmployee = {
      id: builtInEmployeeId("org_1", "amani"),
      organizationId: "org_1",
      key: "amani",
      name: "Amani",
      role: "AI Manager and Dispatcher",
      description: "Coordinates Ledgerly AI employees.",
      icon: "sparkles",
      avatar: { initials: "AM" },
      visibility: "all",
      permissions: ["school:read"],
      effectivePermissions: ["school:read"],
      capabilities: ["coordination", "delegation"],
      tools: ["delegate"],
      memoryScope: "organization",
      status: "active",
      kind: "built-in",
      templateVersion: 1,
      metadata: {},
    };
    const prompt = registry.identityPrompt(employee);
    expect(prompt).toContain("You are Amani");
    expect(prompt).toContain("AI Manager and Dispatcher");
    expect(prompt).toContain("Keep this employee identity stable");
    expect(prompt).not.toContain("Codex");
    expect(prompt).not.toContain("Claude");
  });
});
