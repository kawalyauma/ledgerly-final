import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import type { LedgerlyAiEmployee, LedgerlyAiEmployeeVisibility } from "./types.js";

type EmployeeRow = {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  role: string;
  description: string;
  icon: string | null;
  avatar: Record<string, unknown> | null;
  visibility: LedgerlyAiEmployeeVisibility;
  permissions: unknown;
  capabilities: unknown;
  tools: unknown;
  memoryScope: LedgerlyAiEmployee["memoryScope"];
  status: LedgerlyAiEmployee["status"];
  kind: LedgerlyAiEmployee["kind"];
  templateVersion: number | string;
  metadata: Record<string, unknown> | null;
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isAdmin(principal: AuthPrincipal) {
  return principal.role === "owner" || principal.role === "admin";
}

export function builtInEmployeeId(organizationId: string, key: string) {
  const digest = createHash("md5").update(`${organizationId}:${key}`).digest("hex").slice(0, 20);
  return `laiagt_${key}_${digest}`;
}

export class LedgerlyAiEmployeeRegistry {
  constructor(private readonly db: Pool) {}

  private visible(principal: AuthPrincipal, visibility: LedgerlyAiEmployeeVisibility) {
    if (visibility === "all") return true;
    if (visibility === "admin") return isAdmin(principal) || principal.scopes.includes("admin:read");
    return principal.role !== "integration";
  }

  private map(principal: AuthPrincipal, row: EmployeeRow): LedgerlyAiEmployee {
    const permissions = stringArray(row.permissions);
    const effectivePermissions = isAdmin(principal)
      ? permissions
      : permissions.filter((scope) => principal.scopes.includes(scope));
    return {
      id: row.id,
      organizationId: row.organizationId,
      key: row.key,
      name: row.name,
      role: row.role,
      description: row.description,
      icon: row.icon,
      avatar: row.avatar && typeof row.avatar === "object" ? row.avatar : {},
      visibility: row.visibility,
      permissions,
      effectivePermissions,
      capabilities: stringArray(row.capabilities),
      tools: stringArray(row.tools),
      memoryScope: row.memoryScope,
      status: row.status,
      kind: row.kind,
      templateVersion: Number(row.templateVersion),
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    };
  }

  async ensureBuiltIns(organizationId: string) {
    await this.db.query(
      `INSERT INTO lai_agents(
        id,organization_id,agent_key,display_name,role,description,kind,status,
        capabilities_json,tool_allowlist_json,memory_scope,config_json,icon,avatar_json,
        permissions_json,visibility,template_version
      )
      SELECT
        'laiagt_' || t.agent_key || '_' || substr(md5($1 || ':' || t.agent_key),1,20),
        $1,t.agent_key,t.display_name,t.role,t.description,
        'built-in','active',
        t.capabilities_json,t.tool_allowlist_json,t.memory_scope,t.config_json,t.icon,t.avatar_json,
        t.permissions_json,t.visibility,t.template_version
      FROM lai_agent_templates t
      ON CONFLICT(organization_id,agent_key) DO UPDATE SET
        display_name=EXCLUDED.display_name,
        role=EXCLUDED.role,
        description=EXCLUDED.description,
        kind='built-in',
        capabilities_json=EXCLUDED.capabilities_json,
        tool_allowlist_json=EXCLUDED.tool_allowlist_json,
        memory_scope=EXCLUDED.memory_scope,
        config_json=lai_agents.config_json || EXCLUDED.config_json,
        icon=EXCLUDED.icon,
        avatar_json=EXCLUDED.avatar_json,
        permissions_json=EXCLUDED.permissions_json,
        visibility=EXCLUDED.visibility,
        template_version=EXCLUDED.template_version,
        updated_at=CURRENT_TIMESTAMP`,
      [organizationId],
    );
  }

  private selectSql() {
    return `SELECT
      id,
      organization_id AS "organizationId",
      agent_key AS key,
      display_name AS name,
      role,
      description,
      icon,
      avatar_json AS avatar,
      visibility,
      permissions_json AS permissions,
      capabilities_json AS capabilities,
      tool_allowlist_json AS tools,
      memory_scope AS "memoryScope",
      status,
      kind,
      template_version AS "templateVersion",
      config_json AS metadata
    FROM lai_agents`;
  }

  async list(principal: AuthPrincipal) {
    await this.ensureBuiltIns(principal.organizationId);
    const result = await this.db.query<EmployeeRow>(
      `${this.selectSql()}
       WHERE organization_id=$1 AND status<>'disabled'
       ORDER BY
         CASE agent_key
           WHEN 'amani' THEN 1
           WHEN 'elimu' THEN 2
           WHEN 'hesabu' THEN 3
           WHEN 'ripoti' THEN 4
           WHEN 'kumbuka' THEN 5
           WHEN 'forge' THEN 6
           ELSE 20
         END,
         display_name`,
      [principal.organizationId],
    );
    return result.rows
      .filter((row) => this.visible(principal, row.visibility))
      .map((row) => this.map(principal, row));
  }

  async get(principal: AuthPrincipal, idOrKey: string, includeDisabled = false) {
    await this.ensureBuiltIns(principal.organizationId);
    const result = await this.db.query<EmployeeRow>(
      `${this.selectSql()}
       WHERE organization_id=$1
         AND (id=$2 OR agent_key=$2)
         AND ($3::boolean OR status<>'disabled')
       LIMIT 1`,
      [principal.organizationId, idOrKey, includeDisabled],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "LEDGERLY_AI_EMPLOYEE_NOT_FOUND", "Ledgerly AI employee not found.");
    if (!this.visible(principal, row.visibility)) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to use this Ledgerly AI employee.");
    }
    return this.map(principal, row);
  }

  async resolveSelectable(principal: AuthPrincipal, idOrKey: string) {
    const employee = await this.get(principal, idOrKey);
    if (employee.status === "paused") {
      throw new AppError(409, "LEDGERLY_AI_EMPLOYEE_PAUSED", "This Ledgerly AI employee is currently paused.");
    }
    if (employee.status !== "active" && employee.status !== "testing") {
      throw new AppError(409, "LEDGERLY_AI_EMPLOYEE_UNAVAILABLE", "This Ledgerly AI employee is not available.");
    }
    return employee;
  }

  identityPrompt(employee: LedgerlyAiEmployee | null) {
    if (!employee) return "You are Ledgerly AI.";
    return [
      `You are ${employee.name}, a named Ledgerly AI employee.`,
      `Your role is: ${employee.role}.`,
      employee.description,
      "Keep this employee identity stable for the entire conversation.",
      "Never identify, name, compare, or expose the hidden execution provider or model.",
      `Your enabled capability areas are: ${employee.capabilities.join(", ") || "general assistance"}.`,
    ].join("\n");
  }

  async adminList(principal: AuthPrincipal) {
    if (!isAdmin(principal) && !principal.scopes.includes("admin:read")) {
      throw new AppError(403, "FORBIDDEN", "Employee registry inspection requires administrative permission.");
    }
    await this.ensureBuiltIns(principal.organizationId);
    const result = await this.db.query<EmployeeRow>(
      `${this.selectSql()} WHERE organization_id=$1 ORDER BY display_name`,
      [principal.organizationId],
    );
    return result.rows.map((row) => this.map(principal, row));
  }
}
