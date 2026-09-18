// Purpose-built HR/staff tools. These exist because the generic
// system_catalog -> system_schema -> prepare_system_action discovery path
// repeatedly failed live for staff/position work: models invented wrong
// JSON envelopes for multi-entity requests, guessed wrong endpoints (e.g.
// payroll/employees instead of staff-management/staff), and hr_overview
// reports on a disjoint hr_employees/hr_departments subsystem that AI-created
// staff never populate. These tools do the department/position lookup and
// idempotency-key work in real code, and still only ever *prepare* a
// system.api.request action — nothing executes without human approval.
import { createId } from "./shared.js";
import type { Env } from "./shared.js";
import { executeTool as baseExecute, openAiTools as baseTools } from "./system-tools-v16.js";
import type { ToolContext } from "./tools-v14.js";

const NAMES = ["staff_overview", "create_staff_position", "create_staff_member", "update_staff_pay"] as const;
type HrTool = typeof NAMES[number];

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

const SPECS: Record<HrTool, any> = {
  staff_overview: {
    type: "function", name: "staff_overview", strict: false,
    description: "Get the real, current headcount of staff/teachers actually on record in school-management (school_staff_profiles), broken down by employment status and department. hr_overview reports on a separate, usually-empty HR subsystem — use staff_overview instead whenever asked for a staff, teacher or workforce overview/report.",
    parameters: objectSchema({}),
  },
  create_staff_position: {
    type: "function", name: "create_staff_position", strict: false,
    description: "Prepare creation of exactly ONE new staff position/job title (e.g. Storekeeper, Receptionist). Looks up the department by name if given; if no matching department exists, the position is prepared with no department rather than guessing. Generates a unique position code automatically. Call this once per position — never bundle multiple positions into one call.",
    parameters: objectSchema({ name: { type: "string" }, departmentName: { type: "string", description: "Optional. Existing department name to link. Left unset if no matching department is found." }, isTeaching: { type: "boolean" }, isManagement: { type: "boolean" } }, ["name"]),
  },
  create_staff_member: {
    type: "function", name: "create_staff_member", strict: false,
    description: "Prepare creation of exactly ONE new staff member/teacher. Looks up the position by name if given (also inherits its department). hireDate defaults to today if not stated. Call this once per person — never bundle multiple staff into one call.",
    parameters: objectSchema({
      firstName: { type: "string" }, lastName: { type: "string" },
      positionName: { type: "string", description: "Existing position name to link, e.g. Storekeeper." },
      departmentName: { type: "string", description: "Only used if positionName is not given or not found." },
      isTeacher: { type: "boolean" },
      employmentType: { type: "string", enum: ["permanent", "contract", "part_time", "casual", "intern", "volunteer"] },
      monthlySalary: { type: "number", description: "Monthly base pay in whole currency units, exactly as stated by the user." },
      currency: { type: "string", description: "3-letter currency code, defaults to UGX." },
      hireDate: { type: "string", description: "YYYY-MM-DD, defaults to today." },
    }, ["firstName", "lastName"]),
  },
  update_staff_pay: {
    type: "function", name: "update_staff_pay", strict: false,
    description: "Prepare a base-pay/salary change for an EXISTING staff member found by name or staff number. Never use this to create a new staff member, and never use POST /api/v1/payroll/employees for this — that creates an unrelated separate payroll record.",
    parameters: objectSchema({ query: { type: "string", description: "Staff name or staff number to find the existing record." }, monthlySalary: { type: "number" }, currency: { type: "string" } }, ["query", "monthlySalary"]),
  },
};

function hash(value: string) { let h = 2166136261; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
function codeFromName(value: string, fallback: string) { return value.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 32) || fallback; }

async function findDepartmentByName(db: D1Database, organizationId: string, name?: string) {
  const value = String(name || "").trim();
  if (!value) return null;
  return db.prepare("SELECT id,name FROM school_departments WHERE organization_id=? AND active=true AND name ILIKE ? ORDER BY name LIMIT 1").bind(organizationId, `%${value}%`).first<{ id: string; name: string }>();
}
async function findPositionByName(db: D1Database, organizationId: string, name?: string) {
  const value = String(name || "").trim();
  if (!value) return null;
  return db.prepare("SELECT id,name,department_id AS departmentId FROM school_staff_positions WHERE organization_id=? AND active=true AND name ILIKE ? ORDER BY name LIMIT 1").bind(organizationId, `%${value}%`).first<{ id: string; name: string; departmentId: string | null }>();
}
async function findStaffByQuery(db: D1Database, organizationId: string, query: string) {
  const like = `%${query}%`;
  return db.prepare(`SELECT id,staff_number AS staffNumber,first_name AS firstName,last_name AS lastName FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL AND (staff_number ILIKE ? OR first_name ILIKE ? OR last_name ILIKE ? OR (first_name||' '||last_name) ILIKE ?) ORDER BY last_name LIMIT 1`)
    .bind(organizationId, like, like, like, like).first<{ id: string; staffNumber: string; firstName: string; lastName: string }>();
}

async function prepareApiAction(ctx: ToolContext, method: "POST" | "PATCH", path: string, body: Record<string, unknown>, title: string, summary: string, idemSuffix: string) {
  const payload = { agentKey: ctx.agent.key, method, path, body };
  let key = `conversation:${ctx.conversationId}:hrtool:${method}:${path}:${idemSuffix}:${hash(JSON.stringify(body))}`;
  const id = createId("aea");
  await ctx.db.prepare(`INSERT INTO ae_actions(id,organization_id,agent_key,action_type,title,summary,required_scope,payload_json,idempotency_key,status) VALUES(?,?,?,?,?,?,?,?,?,'suggested') ON CONFLICT(organization_id,idempotency_key) DO NOTHING`)
    .bind(id, ctx.principal.organizationId, ctx.agent.key, "system.api.request", title.slice(0, 240), summary.slice(0, 600), "school:write", JSON.stringify(payload), key).run();
  let action = await ctx.db.prepare("SELECT id,status,title,action_type AS actionType,required_scope AS requiredScope FROM ae_actions WHERE organization_id=? AND idempotency_key=?").bind(ctx.principal.organizationId, key).first<any>();
  if (action && ["failed", "dismissed", "executed"].includes(action.status)) {
    key = `${key}:retry:${id}`;
    await ctx.db.prepare(`INSERT INTO ae_actions(id,organization_id,agent_key,action_type,title,summary,required_scope,payload_json,idempotency_key,status) VALUES(?,?,?,?,?,?,?,?,?,'suggested') ON CONFLICT(organization_id,idempotency_key) DO NOTHING`)
      .bind(id, ctx.principal.organizationId, ctx.agent.key, "system.api.request", title.slice(0, 240), summary.slice(0, 600), "school:write", JSON.stringify(payload), key).run();
    action = await ctx.db.prepare("SELECT id,status,title,action_type AS actionType,required_scope AS requiredScope FROM ae_actions WHERE organization_id=? AND idempotency_key=?").bind(ctx.principal.organizationId, key).first<any>();
  }
  return { prepared: true, executed: false, requiresHumanApproval: true, approvalSurface: "chat", action };
}

export function openAiTools(agent: any, requested?: string[] | null) {
  return [...baseTools(agent, requested), ...NAMES.filter(name => agent.tools.includes(name) && (!requested || requested.includes(name))).map(name => SPECS[name])];
}

export async function executeTool(ctx: ToolContext & { env?: Env }, name: string, raw: unknown) {
  if (!NAMES.includes(name as HrTool)) return baseExecute(ctx, name, raw);
  if (!ctx.agent.tools.includes(name)) throw new Error(`${name} is not enabled for this employee`);
  const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const organizationId = ctx.principal.organizationId;

  if (name === "staff_overview") {
    const [total, teaching, byStatus, byDept] = await Promise.all([
      ctx.db.prepare("SELECT COUNT(*) AS n FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL").bind(organizationId).first<any>(),
      ctx.db.prepare("SELECT COUNT(*) AS n FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL AND is_teacher=true").bind(organizationId).first<any>(),
      ctx.db.prepare("SELECT employment_status AS status, COUNT(*) AS n FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL GROUP BY employment_status").bind(organizationId).all(),
      ctx.db.prepare("SELECT COALESCE(d.name,'Unassigned') AS department, COUNT(*) AS n FROM school_staff_profiles s LEFT JOIN school_departments d ON d.id=s.department_id WHERE s.organization_id=? AND s.deleted_at IS NULL GROUP BY d.name").bind(organizationId).all(),
    ]);
    return { totalStaff: Number(total?.n || 0), teachers: Number(teaching?.n || 0), byEmploymentStatus: byStatus.results, byDepartment: byDept.results };
  }

  if (name === "create_staff_position") {
    const positionName = String(args.name || "").trim();
    if (!positionName) throw new Error("A position name is required");
    const dept = await findDepartmentByName(ctx.db, organizationId, args.departmentName as string | undefined);
    const code = codeFromName(positionName, "POSITION");
    const body: Record<string, unknown> = { code, name: positionName, isTeaching: Boolean(args.isTeaching), isManagement: Boolean(args.isManagement), active: true };
    if (dept) body.departmentId = dept.id;
    return prepareApiAction(ctx, "POST", "/api/v1/school/staff-management/positions", body,
      `Create position: ${positionName}`,
      dept ? `Create the ${positionName} position under ${dept.name}.` : `Create the ${positionName} position with no department (none matched by name).`,
      code);
  }

  if (name === "create_staff_member") {
    const firstName = String(args.firstName || "").trim(), lastName = String(args.lastName || "").trim();
    if (!firstName || !lastName) throw new Error("firstName and lastName are required");
    const position = await findPositionByName(ctx.db, organizationId, args.positionName as string | undefined);
    const dept = position?.departmentId ? null : await findDepartmentByName(ctx.db, organizationId, args.departmentName as string | undefined);
    const hireDate = String(args.hireDate || "").trim() || new Date().toISOString().slice(0, 10);
    const body: Record<string, unknown> = {
      firstName, lastName, hireDate,
      isTeacher: Boolean(args.isTeacher),
      employmentType: args.employmentType || "permanent",
      payType: "salary",
      basePayMinor: Math.round(Number(args.monthlySalary || 0)),
      currency: String(args.currency || "UGX").toUpperCase(),
    };
    if (position) body.positionId = position.id;
    if (dept) body.departmentId = dept.id;
    return prepareApiAction(ctx, "POST", "/api/v1/school/staff-management/staff", body,
      `Create staff: ${firstName} ${lastName}`,
      position ? `Create ${firstName} ${lastName} as ${position.name}.` : `Create ${firstName} ${lastName}.`,
      `${firstName}${lastName}${hireDate}`);
  }

  if (name === "update_staff_pay") {
    const query = String(args.query || "").trim();
    if (!query) throw new Error("A staff name or staff number is required");
    const staff = await findStaffByQuery(ctx.db, organizationId, query);
    if (!staff) return { found: false, message: `No staff member matching "${query}" was found. Do not guess an id — tell the user plainly none matched.` };
    const body = { basePayMinor: Math.round(Number(args.monthlySalary || 0)), currency: String(args.currency || "UGX").toUpperCase() };
    return prepareApiAction(ctx, "PATCH", `/api/v1/school/staff-management/staff/${staff.id}`, body,
      `Update pay: ${staff.firstName} ${staff.lastName}`,
      `Set ${staff.firstName} ${staff.lastName}'s base pay.`,
      staff.id);
  }

  throw new Error(`Unhandled HR tool ${name}`);
}
