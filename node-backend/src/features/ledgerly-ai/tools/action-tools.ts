import { z } from "zod";
import { createId } from "../../core-identity/security.js";
import type { LedgerlyAiToolDefinition } from "./types.js";

function schema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

const workTaskCreate: LedgerlyAiToolDefinition = {
  name: "work.task.create",
  category: "work",
  description: "Create a Ledgerly work task after explicit human approval.",
  inputSchema: z.object({
    projectId: z.string().max(160).nullable().optional(),
    taskNumber: z.string().trim().min(1).max(60),
    title: z.string().trim().min(2).max(220),
    description: z.string().max(5000).nullable().optional(),
    priority: z.enum(["low","normal","high","urgent"]).default("normal"),
    dueAt: z.string().datetime().nullable().optional(),
  }),
  inputJsonSchema: schema({
    projectId: { type: ["string","null"] },
    taskNumber: { type: "string" },
    title: { type: "string" },
    description: { type: ["string","null"] },
    priority: { type: "string", enum: ["low","normal","high","urgent"] },
    dueAt: { type: ["string","null"], format: "date-time" },
  }, ["taskNumber","title"]),
  requiredScopes: ["work:write"],
  riskLevel: "medium",
  approvalRequired: true,
  mutating: true,
  async execute(ctx, input) {
    if (input.projectId) {
      const project = await ctx.runtime.db.query(
        "SELECT 1 FROM work_projects WHERE id=$1 AND organization_id=$2",
        [input.projectId, ctx.principal.organizationId],
      );
      if (!project.rowCount) throw new Error("Project does not belong to this organization.");
    }
    const id = createId("wts");
    await ctx.runtime.db.query(
      `INSERT INTO work_tasks(
        id,organization_id,project_id,task_number,title,description,priority,due_at,created_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,ctx.principal.organizationId,input.projectId ?? null,input.taskNumber,input.title,
        input.description ?? null,input.priority,input.dueAt ?? null,ctx.principal.userId,
      ],
    );
    return { id, status: "todo", ...input };
  },
};

const attendanceRecord: LedgerlyAiToolDefinition = {
  name: "attendance.record",
  category: "attendance",
  description: "Record or correct a learner attendance mark after explicit human approval.",
  inputSchema: z.object({
    sessionId: z.string().min(1).max(160),
    studentId: z.string().min(1).max(160),
    status: z.enum(["present","absent","late","excused","sick","permission"]),
    minutesLate: z.number().int().min(0).max(1440).default(0),
    notes: z.string().max(2000).nullable().optional(),
  }),
  inputJsonSchema: schema({
    sessionId: { type: "string" },
    studentId: { type: "string" },
    status: { type: "string", enum: ["present","absent","late","excused","sick","permission"] },
    minutesLate: { type: "integer", minimum: 0, maximum: 1440 },
    notes: { type: ["string","null"] },
  }, ["sessionId","studentId","status"]),
  requiredScopes: ["school:write"],
  riskLevel: "high",
  approvalRequired: true,
  mutating: true,
  async execute(ctx, input) {
    const valid = await ctx.runtime.db.query(
      `SELECT 1
         FROM school_student_attendance_sessions se
         JOIN school_students s ON s.organization_id=se.organization_id
        WHERE se.organization_id=$1 AND se.id=$2 AND s.id=$3
          AND s.deleted_at IS NULL AND se.status='open' LIMIT 1`,
      [ctx.principal.organizationId,input.sessionId,input.studentId],
    );
    if (!valid.rowCount) {
      throw new Error("Attendance session or learner is invalid for this organization, or the session is not open.");
    }
    const id = createId("satt");
    const result = await ctx.runtime.db.query(
      `INSERT INTO school_student_attendance_records(
        id,organization_id,session_id,student_id,status,minutes_late,notes,source,recorded_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,'api',$8)
      ON CONFLICT(organization_id,session_id,student_id) DO UPDATE SET
        status=EXCLUDED.status,
        minutes_late=EXCLUDED.minutes_late,
        notes=EXCLUDED.notes,
        source='api',
        recorded_by=EXCLUDED.recorded_by,
        updated_at=CURRENT_TIMESTAMP
      RETURNING id,session_id AS "sessionId",student_id AS "studentId",
                status,minutes_late AS "minutesLate",notes`,
      [
        id,ctx.principal.organizationId,input.sessionId,input.studentId,input.status,
        input.minutesLate,input.notes ?? null,ctx.principal.userId,
      ],
    );
    return result.rows[0];
  },
};

export const actionTools: LedgerlyAiToolDefinition[] = [workTaskCreate, attendanceRecord];
