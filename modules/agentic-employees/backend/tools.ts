import { createId } from "../../../src/lib/ids";
import type { AuthPrincipal } from "../../../src/types";
import type { AgentDefinition } from "./policy";
import { hasScope, isToolAllowed } from "./policy";

export type ToolContext = {
  db: D1Database;
  principal: AuthPrincipal;
  agent: AgentDefinition;
  conversationId: string;
  requestedTools?: string[] | null;
};

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const TOOL_SPECS: Record<string, ToolSpec> = {
  school_snapshot: {
    name: "school_snapshot",
    description: "Get high-level counts for this school organization.",
    parameters: objectSchema({}),
  },
  search_students: {
    name: "search_students",
    description: "Search students in this school by name, admission number or student number.",
    parameters: objectSchema({
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    }, ["query"]),
  },
  search_staff: {
    name: "search_staff",
    description: "Search staff in this school by name or staff number.",
    parameters: objectSchema({
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    }, ["query"]),
  },
  fee_balance_lookup: {
    name: "fee_balance_lookup",
    description: "Look up a student's current posted school-fees balance by student ID, admission number, student number or name.",
    parameters: objectSchema({ query: { type: "string" } }, ["query"]),
  },
  fee_arrears_summary: {
    name: "fee_arrears_summary",
    description: "Return the largest current posted student fee arrears for this school.",
    parameters: objectSchema({ limit: { type: "integer", minimum: 1, maximum: 30 } }),
  },
  draft_communication: {
    name: "draft_communication",
    description: "Prepare a school communication for human approval. This tool never sends directly.",
    parameters: objectSchema({
      audience: { type: "string" },
      channel: { type: "string", enum: ["sms", "whatsapp", "email"] },
      subject: { type: "string" },
      message: { type: "string" },
    }, ["audience", "channel", "message"]),
  },
};

function clampLimit(value: unknown, fallback = 10, max = 20) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : fallback;
}

function need(ctx: ToolContext, scope: string) {
  if (!hasScope(ctx.principal, scope)) throw new Error(`User is missing required Ledgerly scope: ${scope}`);
}

export function openAiTools(agent: AgentDefinition, requestedTools?: string[] | null) {
  return Object.values(TOOL_SPECS)
    .filter(spec => isToolAllowed(agent, spec.name, requestedTools))
    .map(spec => ({
      type: "function",
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      strict: true,
    }));
}

export async function executeTool(ctx: ToolContext, name: string, raw: unknown) {
  if (!isToolAllowed(ctx.agent, name, ctx.requestedTools)) {
    throw new Error(`Tool ${name} is not allowed for ${ctx.agent.key}`);
  }

  const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const organizationId = ctx.principal.organizationId;

  switch (name) {
    case "school_snapshot": {
      need(ctx, "school:read");
      const [students, staff, guardians, classes] = await Promise.all([
        ctx.db.prepare("SELECT COUNT(*) AS n FROM school_students WHERE organization_id=? AND deleted_at IS NULL AND status='active'").bind(organizationId).first<{ n: number }>(),
        ctx.db.prepare("SELECT COUNT(*) AS n FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL AND employment_status='active'").bind(organizationId).first<{ n: number }>(),
        ctx.db.prepare("SELECT COUNT(*) AS n FROM school_guardians WHERE organization_id=? AND active=1").bind(organizationId).first<{ n: number }>(),
        ctx.db.prepare("SELECT COUNT(*) AS n FROM school_classes WHERE organization_id=? AND active=1").bind(organizationId).first<{ n: number }>(),
      ]);
      return {
        activeStudents: Number(students?.n || 0),
        activeStaff: Number(staff?.n || 0),
        activeGuardians: Number(guardians?.n || 0),
        activeClasses: Number(classes?.n || 0),
      };
    }

    case "search_students": {
      need(ctx, "school:read");
      const query = `%${String(args.query || "").trim()}%`;
      const limit = clampLimit(args.limit);
      const rows = await ctx.db.prepare(`
        SELECT id, admission_number AS admissionNumber, student_number AS studentNumber,
               first_name AS firstName, middle_name AS middleName, last_name AS lastName,
               status, class_id AS classId, stream_id AS streamId
        FROM school_students
        WHERE organization_id=? AND deleted_at IS NULL
          AND (admission_number LIKE ? OR student_number LIKE ? OR first_name LIKE ? OR middle_name LIKE ?
               OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?)
        ORDER BY last_name, first_name LIMIT ?
      `).bind(organizationId, query, query, query, query, query, query, limit).all();
      return { students: rows.results };
    }

    case "search_staff": {
      need(ctx, "school:read");
      const query = `%${String(args.query || "").trim()}%`;
      const limit = clampLimit(args.limit);
      const rows = await ctx.db.prepare(`
        SELECT id, staff_number AS staffNumber, first_name AS firstName, middle_name AS middleName,
               last_name AS lastName, employment_status AS employmentStatus,
               department_id AS departmentId, position_id AS positionId
        FROM school_staff_profiles
        WHERE organization_id=? AND deleted_at IS NULL
          AND (staff_number LIKE ? OR first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ?
               OR (first_name || ' ' || last_name) LIKE ?)
        ORDER BY last_name, first_name LIMIT ?
      `).bind(organizationId, query, query, query, query, query, limit).all();
      return { staff: rows.results };
    }

    case "fee_balance_lookup": {
      need(ctx, "school:read");
      const value = String(args.query || "").trim();
      const like = `%${value}%`;
      const student = await ctx.db.prepare(`
        SELECT id, admission_number AS admissionNumber, student_number AS studentNumber,
               first_name AS firstName, last_name AS lastName
        FROM school_students
        WHERE organization_id=? AND deleted_at IS NULL
          AND (id=? OR admission_number=? OR student_number=? OR (first_name || ' ' || last_name) LIKE ?)
        ORDER BY CASE WHEN id=? OR admission_number=? OR student_number=? THEN 0 ELSE 1 END, last_name
        LIMIT 1
      `).bind(organizationId, value, value, value, like, value, value, value).first<Record<string, unknown>>();
      if (!student) return { found: false };

      const balance = await ctx.db.prepare(`
        SELECT COALESCE(SUM(c.total_minor - c.credited_minor - c.written_off_minor - COALESCE(p.paid_minor, 0)), 0) AS balanceMinor,
               COUNT(*) AS chargeCount
        FROM school_student_fee_charges c
        JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
        LEFT JOIN (
          SELECT organization_id, document_id, SUM(amount_minor) AS paid_minor
          FROM payment_allocations WHERE reversed_at IS NULL
          GROUP BY organization_id, document_id
        ) p ON p.organization_id=c.organization_id AND p.document_id=c.document_id
        WHERE c.organization_id=? AND c.student_id=? AND c.status<>'voided'
          AND d.status IN ('open','partially_paid','paid')
      `).bind(organizationId, String(student.id)).first<{ balanceMinor: number; chargeCount: number }>();
      return {
        found: true,
        student,
        balanceMinor: Number(balance?.balanceMinor || 0),
        chargeCount: Number(balance?.chargeCount || 0),
      };
    }

    case "fee_arrears_summary": {
      need(ctx, "school:read");
      const limit = clampLimit(args.limit, 10, 30);
      const rows = await ctx.db.prepare(`
        SELECT s.id, s.admission_number AS admissionNumber,
               s.first_name || ' ' || s.last_name AS studentName,
               ROUND(SUM(c.total_minor - c.credited_minor - c.written_off_minor - COALESCE(p.paid_minor, 0))) AS balanceMinor
        FROM school_student_fee_charges c
        JOIN school_students s ON s.id=c.student_id AND s.organization_id=c.organization_id
        JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
        LEFT JOIN (
          SELECT organization_id, document_id, SUM(amount_minor) AS paid_minor
          FROM payment_allocations WHERE reversed_at IS NULL
          GROUP BY organization_id, document_id
        ) p ON p.organization_id=c.organization_id AND p.document_id=c.document_id
        WHERE c.organization_id=? AND c.status<>'voided' AND d.status IN ('open','partially_paid','paid')
        GROUP BY s.id
        HAVING SUM(c.total_minor - c.credited_minor - c.written_off_minor - COALESCE(p.paid_minor, 0)) > 0
        ORDER BY balanceMinor DESC LIMIT ?
      `).bind(organizationId, limit).all();
      return { arrears: rows.results };
    }

    case "draft_communication": {
      need(ctx, "school:read");
      const approvalId = createId("aap");
      const payload = {
        audience: String(args.audience || ""),
        channel: String(args.channel || "sms"),
        subject: String(args.subject || ""),
        message: String(args.message || ""),
      };
      await ctx.db.prepare(`
        INSERT INTO ae_approvals
          (id, organization_id, conversation_id, agent_key, requested_by, action_type, required_scope, payload_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).bind(
        approvalId,
        organizationId,
        ctx.conversationId,
        ctx.agent.key,
        ctx.principal.userId,
        "communication.send",
        "communications:write",
        JSON.stringify(payload),
      ).run();
      return {
        approvalId,
        status: "pending",
        action: "communication.send",
        message: "Communication prepared. A human with communications:write must approve it before execution.",
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
