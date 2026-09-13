import type { Env } from "../../../src/types";
import { buildFamilyReport } from "./family-report";
import { resolveGuardianFamily } from "./family-resolver";
import { delegateToEmployee } from "./delegation";
import { isAgentKey, isToolAllowed, type AgentDefinition } from "./policy";
import { executeTool as executeBaseTool, openAiTools as baseOpenAiTools, type ToolContext } from "./tools";

const EXTRA_TOOL_SPECS = {
  resolve_guardian_family: {
    type: "function",
    name: "resolve_guardian_family",
    description: "Resolve a guardian by school records and list only students explicitly linked to that guardian. Use this before making family claims.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        studentGender: { type: "string", enum: ["all", "male", "female"] },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: false,
  },
  family_comprehensive_report: {
    type: "function",
    name: "family_comprehensive_report",
    description: "Create a cumulative family report for students linked to a guardian using published academic results, official attendance and posted fee data. If guardian resolution is ambiguous, return candidates instead of guessing.",
    parameters: {
      type: "object",
      properties: {
        guardianQuery: { type: "string" },
        studentGender: { type: "string", enum: ["all", "male", "female"] },
        includeAcademic: { type: "boolean" },
        includeAttendance: { type: "boolean" },
        includeFinance: { type: "boolean" },
        maxExamHistory: { type: "integer", minimum: 1, maximum: 60 },
      },
      required: ["guardianQuery"],
      additionalProperties: false,
    },
    strict: false,
  },
  delegate_to_employee: {
    type: "function",
    name: "delegate_to_employee",
    description: "Delegate one bounded read-only subtask to another configured Ledgerly AI employee. Delegated employees cannot send communications, make writes or delegate again.",
    parameters: {
      type: "object",
      properties: {
        employee: { type: "string", enum: ["secretary", "dos", "bursar", "headteacher", "hr", "librarian"] },
        request: { type: "string" },
      },
      required: ["employee", "request"],
      additionalProperties: false,
    },
    strict: false,
  },
} as const;

function hasScope(ctx: ToolContext, scope: string) {
  return ctx.principal.role === "owner" || ctx.principal.role === "admin" || ctx.principal.scopes.includes(scope);
}

export function openAiTools(agent: AgentDefinition, requestedTools?: string[] | null) {
  const base = baseOpenAiTools(agent, requestedTools).map(tool => ({ ...tool, strict: false }));
  const extras = Object.values(EXTRA_TOOL_SPECS).filter(spec => isToolAllowed(agent, spec.name, requestedTools));
  return [...base, ...extras];
}

export async function executeTool(ctx: ToolContext & { env?: Env & Record<string, unknown> }, name: string, raw: unknown) {
  if (!(name in EXTRA_TOOL_SPECS)) return executeBaseTool(ctx, name, raw);
  if (!isToolAllowed(ctx.agent, name, ctx.requestedTools)) throw new Error(`Tool ${name} is not allowed for ${ctx.agent.key}`);
  if (!hasScope(ctx, "school:read")) throw new Error("User is missing required Ledgerly scope: school:read");
  const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  if (name === "resolve_guardian_family") {
    return resolveGuardianFamily(
      ctx.db,
      ctx.principal.organizationId,
      String(args.query || ""),
      args.studentGender === "male" || args.studentGender === "female" ? args.studentGender : "all",
    );
  }

  if (name === "family_comprehensive_report") {
    return buildFamilyReport(
      ctx.db,
      ctx.principal.organizationId,
      ctx.conversationId,
      ctx.principal.userId,
      ctx.agent.key,
      {
        guardianQuery: String(args.guardianQuery || ""),
        studentGender: args.studentGender === "male" || args.studentGender === "female" ? args.studentGender : "all",
        includeAcademic: args.includeAcademic !== false,
        includeAttendance: args.includeAttendance !== false,
        includeFinance: args.includeFinance !== false,
        maxExamHistory: Number(args.maxExamHistory || 24),
      },
    );
  }

  if (name === "delegate_to_employee") {
    if (!ctx.env) throw new Error("AI runtime environment is unavailable for delegation");
    const employee = String(args.employee || "");
    if (!isAgentKey(employee)) throw new Error("Unknown Ledgerly AI employee");
    const request = String(args.request || "").trim();
    if (!request) throw new Error("Delegated request is required");
    return delegateToEmployee({
      db: ctx.db,
      env: ctx.env,
      principal: ctx.principal,
      parentConversationId: ctx.conversationId,
      fromAgent: ctx.agent,
      toAgentKey: employee,
      request,
    });
  }

  throw new Error(`Unsupported AI tool ${name}`);
}
