import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import type { LedgerlyAiEmployee } from "../employees/types.js";
import type {
  LedgerlyAiToolCatalogItem,
  LedgerlyAiToolDefinition,
} from "./types.js";

function isAdmin(principal: AuthPrincipal) {
  return principal.role === "owner" || principal.role === "admin";
}

function scopesSatisfied(
  scopes: readonly string[],
  required: readonly string[],
  mode: "all" | "any",
) {
  if (!required.length) return true;
  const set = new Set(scopes);
  return mode === "all"
    ? required.every((scope) => set.has(scope))
    : required.some((scope) => set.has(scope));
}

export class LedgerlyAiToolRegistry {
  private readonly tools = new Map<string, LedgerlyAiToolDefinition>();

  register(definition: LedgerlyAiToolDefinition) {
    if (this.tools.has(definition.name)) {
      throw new Error(`Duplicate Ledgerly AI tool: ${definition.name}`);
    }
    this.tools.set(definition.name, definition);
    return this;
  }

  registerMany(definitions: LedgerlyAiToolDefinition[]) {
    for (const definition of definitions) this.register(definition);
    return this;
  }

  has(name: string) {
    return this.tools.has(name);
  }

  get(name: string) {
    const tool = this.tools.get(name);
    if (!tool) throw new AppError(404, "LEDGERLY_AI_TOOL_NOT_FOUND", "Ledgerly AI tool not found.");
    return tool;
  }

  private employeeAllows(employee: LedgerlyAiEmployee | null, tool: LedgerlyAiToolDefinition) {
    if (!employee) return true;
    if (!employee.tools.includes(tool.name)) return false;
    return scopesSatisfied(
      employee.permissions,
      tool.requiredScopes,
      tool.scopeMode ?? "all",
    );
  }

  private userAllows(principal: AuthPrincipal, tool: LedgerlyAiToolDefinition) {
    if (isAdmin(principal)) return true;
    return scopesSatisfied(
      principal.scopes,
      tool.requiredScopes,
      tool.scopeMode ?? "all",
    );
  }

  canUse(
    principal: AuthPrincipal,
    employee: LedgerlyAiEmployee | null,
    tool: LedgerlyAiToolDefinition,
  ) {
    return this.userAllows(principal, tool) && this.employeeAllows(employee, tool);
  }

  assertAllowed(
    principal: AuthPrincipal,
    employee: LedgerlyAiEmployee | null,
    tool: LedgerlyAiToolDefinition,
  ) {
    if (!this.userAllows(principal, tool)) {
      throw new AppError(
        403,
        "LEDGERLY_AI_TOOL_PERMISSION_DENIED",
        `You do not have the Ledgerly permissions required for ${tool.name}.`,
        { requiredScopes: tool.requiredScopes, scopeMode: tool.scopeMode ?? "all" },
      );
    }
    if (!this.employeeAllows(employee, tool)) {
      throw new AppError(
        403,
        "LEDGERLY_AI_EMPLOYEE_TOOL_DENIED",
        "This Ledgerly AI employee is not allowed to use the requested tool.",
        { toolName: tool.name, employeeKey: employee?.key ?? null },
      );
    }
  }

  catalog(
    principal: AuthPrincipal,
    employee: LedgerlyAiEmployee | null,
  ): LedgerlyAiToolCatalogItem[] {
    return [...this.tools.values()]
      .filter((tool) => this.canUse(principal, employee, tool))
      .map((tool) => ({
        name: tool.name,
        category: tool.category,
        description: tool.description,
        inputSchema: tool.inputJsonSchema,
        requiredScopes: tool.requiredScopes,
        scopeMode: tool.scopeMode ?? "all",
        riskLevel: tool.riskLevel,
        approvalRequired: tool.approvalRequired,
        mutating: tool.mutating,
        productionAction: Boolean(tool.productionAction),
        destructive: Boolean(tool.destructive),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
