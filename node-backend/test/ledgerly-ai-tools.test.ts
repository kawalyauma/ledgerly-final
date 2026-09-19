import { describe, expect, it } from "vitest";
import type { AuthPrincipal } from "../src/http/types.js";
import type { LedgerlyAiEmployee } from "../src/features/ledgerly-ai/employees/types.js";
import { actionTools } from "../src/features/ledgerly-ai/tools/action-tools.js";
import {
  containsLedgerlyAiToolCallMarker,
  parseLedgerlyAiToolCall,
} from "../src/features/ledgerly-ai/tools/protocol.js";
import { LedgerlyAiToolRegistry } from "../src/features/ledgerly-ai/tools/registry.js";
import { schoolTools } from "../src/features/ledgerly-ai/tools/school-tools.js";
import { prepareSafeTenantSql } from "../src/features/ledgerly-ai/tools/sql-safety.js";

const principal: AuthPrincipal = {
  userId: "usr_1",
  organizationId: "org_1",
  role: "manager",
  scopes: ["school:read"],
};

const elimu: LedgerlyAiEmployee = {
  id: "laiagt_elimu",
  organizationId: "org_1",
  key: "elimu",
  name: "Elimu",
  role: "Academic Analyst",
  description: "Academic analysis.",
  icon: "graduation-cap",
  avatar: {},
  visibility: "staff",
  permissions: ["school:read", "school:write", "reports:read"],
  effectivePermissions: ["school:read"],
  capabilities: ["academic-analysis"],
  tools: ["student.lookup", "attendance.read", "attendance.record"],
  memoryScope: "organization",
  status: "active",
  kind: "built-in",
  templateVersion: 1,
  metadata: {},
};

describe("Ledgerly AI tool gateway", () => {
  it("exposes only tools allowed by both the user and employee", () => {
    const registry = new LedgerlyAiToolRegistry()
      .registerMany([...schoolTools, ...actionTools]);
    const names = registry.catalog(principal, elimu).map((tool) => tool.name);
    expect(names).toContain("student.lookup");
    expect(names).toContain("attendance.read");
    expect(names).not.toContain("attendance.record");
    expect(names).not.toContain("work.task.create");
  });

  it("classifies sensitive writes behind approval", () => {
    const attendance = actionTools.find((tool) => tool.name === "attendance.record");
    const task = actionTools.find((tool) => tool.name === "work.task.create");
    expect(attendance?.approvalRequired).toBe(true);
    expect(attendance?.riskLevel).toBe("high");
    expect(attendance?.mutating).toBe(true);
    expect(task?.approvalRequired).toBe(true);
    expect(task?.riskLevel).toBe("medium");
  });

  it("parses only the exact tool-call envelope", () => {
    const call = parseLedgerlyAiToolCall(
      '[[LEDGERLY_TOOL_CALL]]{"name":"student.lookup","arguments":{"query":"Mwebe"}}[[/LEDGERLY_TOOL_CALL]]',
    );
    expect(call).toEqual({ name: "student.lookup", arguments: { query: "Mwebe" } });
    expect(parseLedgerlyAiToolCall("Please call student.lookup")).toBeNull();
    expect(containsLedgerlyAiToolCallMarker("[[LEDGERLY_TOOL_CALL]]broken")).toBe(true);
  });

  it("requires a tenant predicate for every safe SQL table alias", () => {
    const plan = prepareSafeTenantSql(
      "SELECT s.id,s.admission_number FROM school_students s WHERE s.organization_id=$1 AND s.status=$2",
      "org_1",
      ["active"],
      25,
    );
    expect(plan.params).toEqual(["org_1", "active"]);
    expect(plan.tables).toEqual(["school_students"]);
    expect(plan.sql).toContain("LIMIT 25");

    expect(() => prepareSafeTenantSql(
      "SELECT s.id FROM school_students s WHERE s.status=$2",
      "org_1",
      ["active"],
    )).toThrow(/organization_id/);
  });

  it("rejects mutations, comments, multiple statements, and unapproved tables", () => {
    expect(() => prepareSafeTenantSql(
      "UPDATE school_students SET status='inactive' WHERE organization_id=$1",
      "org_1",
    )).toThrow(/SELECT/);
    expect(() => prepareSafeTenantSql(
      "SELECT s.id FROM school_students s WHERE s.organization_id=$1; SELECT 1",
      "org_1",
    )).toThrow(/one statement/);
    expect(() => prepareSafeTenantSql(
      "SELECT s.id FROM school_students s WHERE s.organization_id=$1 -- ignore",
      "org_1",
    )).toThrow(/no SQL comments/);
    expect(() => prepareSafeTenantSql(
      "SELECT p.pid FROM pg_stat_activity p WHERE p.organization_id=$1",
      "org_1",
    )).toThrow(/not available/);
  });
});
