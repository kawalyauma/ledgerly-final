import type { Env } from "./shared.js";
import { buildFamilyReport } from "./family-report.js";
import { resolveGuardianFamily } from "./family-resolver.js";
import { delegateToEmployee } from "./delegation.js";
import { isAgentKey, type AgentDefinition } from "./policy.js";
import { executeTool as executeBaseTool, openAiTools as baseOpenAiTools, type ToolContext } from "./tools.js";

type ExtraToolName = "resolve_guardian_family" | "family_comprehensive_report" | "delegate_to_employee";

const extraSpecs: Record<ExtraToolName, any> = {
  resolve_guardian_family: {
    type: "function", name: "resolve_guardian_family", strict: false,
    description: "Resolve a guardian and students using recorded school guardian links. Never infer family relationships from surnames. Use studentGender=male for sons and female for daughters.",
    parameters: { type: "object", properties: { query: { type: "string" }, studentGender: { type: "string", enum: ["all", "male", "female"] } }, required: ["query"], additionalProperties: false },
  },
  family_comprehensive_report: {
    type: "function", name: "family_comprehensive_report", strict: false,
    description: "Build a cumulative family report from published academic results, official attendance and posted fee data. Use studentGender=male for sons and female for daughters. Return ambiguity instead of guessing a guardian.",
    parameters: { type: "object", properties: {
      guardianQuery: { type: "string" }, studentGender: { type: "string", enum: ["all", "male", "female"] },
      includeAcademic: { type: "boolean" }, includeAttendance: { type: "boolean" }, includeFinance: { type: "boolean" },
      maxExamHistory: { type: "integer", minimum: 1, maximum: 60 },
    }, required: ["guardianQuery"], additionalProperties: false },
  },
  delegate_to_employee: {
    type: "function", name: "delegate_to_employee", strict: false,
    description: "Delegate one read-only subtask to a permitted Ledgerly AI employee. The child employee cannot write, communicate or delegate again.",
    parameters: { type: "object", properties: {
      employee: { type: "string", enum: ["secretary", "dos", "bursar", "headteacher", "hr", "librarian"] },
      request: { type: "string" },
    }, required: ["employee", "request"], additionalProperties: false },
  },
};

const extraAllow: Partial<Record<AgentDefinition["key"], readonly ExtraToolName[]>> = {
  secretary: ["resolve_guardian_family"],
  dos: ["resolve_guardian_family", "family_comprehensive_report", "delegate_to_employee"],
  headteacher: ["resolve_guardian_family", "family_comprehensive_report", "delegate_to_employee"],
};

const legacyDefault: Partial<Record<AgentDefinition["key"], readonly string[]>> = {
  secretary: ["school_snapshot", "search_students", "search_staff", "communications_summary", "prepare_communication"],
  dos: ["school_snapshot", "search_students", "search_staff", "academics_overview", "lesson_plan_queue", "scheme_coverage", "prepare_communication"],
  headteacher: ["school_snapshot", "search_students", "search_staff", "academics_overview", "lesson_plan_queue", "scheme_coverage", "hr_overview", "hr_leave_queue", "fee_collection_summary", "fee_arrears_summary", "books_overview", "communications_summary", "prepare_communication"],
};

function sameSet(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every(value => set.has(value));
}

function extraAllowed(agent: AgentDefinition, tool: ExtraToolName, requested?: string[] | null) {
  if (!(extraAllow[agent.key] || []).includes(tool)) return false;
  if (!requested || sameSet(requested, agent.tools)) return true;
  const previous = legacyDefault[agent.key];
  if (previous && sameSet(requested, previous)) return true;
  return requested.includes(tool);
}

function canReadSchool(ctx: ToolContext) {
  return ctx.principal.role === "owner" || ctx.principal.role === "admin" || ctx.principal.scopes.includes("school:read");
}

export function openAiTools(agent: AgentDefinition, requested?: string[] | null) {
  const base = baseOpenAiTools(agent, requested).map(tool => ({ ...tool, strict: false }));
  const extras = (Object.keys(extraSpecs) as ExtraToolName[]).filter(name => extraAllowed(agent, name, requested)).map(name => extraSpecs[name]);
  return [...base, ...extras];
}

export async function executeTool(ctx: ToolContext & { env?: Env & Record<string, unknown> }, name: string, raw: unknown) {
  if (!(name in extraSpecs)) return executeBaseTool(ctx, name, raw);
  if (!extraAllowed(ctx.agent, name as ExtraToolName, ctx.requestedTools)) throw new Error(`Tool ${name} is not allowed for ${ctx.agent.key}`);
  if (!canReadSchool(ctx)) throw new Error("User is missing required Ledgerly scope: school:read");
  const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  if (name === "resolve_guardian_family") return resolveGuardianFamily(
    ctx.db, ctx.principal.organizationId, String(args.query || ""),
    args.studentGender === "male" || args.studentGender === "female" ? args.studentGender : "all",
  );

  if (name === "family_comprehensive_report") return buildFamilyReport(
    ctx.db, ctx.principal.organizationId, ctx.conversationId, ctx.principal.userId, ctx.agent.key,
    {
      guardianQuery: String(args.guardianQuery || ""),
      studentGender: args.studentGender === "male" || args.studentGender === "female" ? args.studentGender : "all",
      includeAcademic: args.includeAcademic !== false,
      includeAttendance: args.includeAttendance !== false,
      includeFinance: args.includeFinance !== false,
      maxExamHistory: Number(args.maxExamHistory || 24),
    },
  );

  if (!ctx.env) throw new Error("AI runtime environment is unavailable for delegation");
  const employee = String(args.employee || ""), request = String(args.request || "").trim();
  if (!isAgentKey(employee)) throw new Error("Unknown Ledgerly AI employee");
  if (!request) throw new Error("Delegated request is required");
  return delegateToEmployee({
    db: ctx.db, env: ctx.env, principal: ctx.principal, parentConversationId: ctx.conversationId,
    fromAgent: ctx.agent, toAgentKey: employee, request,
  });
}
