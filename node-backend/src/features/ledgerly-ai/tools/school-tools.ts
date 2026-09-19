import { z } from "zod";
import type { LedgerlyAiToolDefinition } from "./types.js";

function schema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}
function cap(value: number | undefined, fallback: number, max: number) {
  return Math.min(Math.max(value ?? fallback, 1), max);
}

const studentLookup: LedgerlyAiToolDefinition = {
  name: "student.lookup",
  category: "school",
  description: "Find learners by ID, admission number, student number, or name.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  inputJsonSchema: schema({
    query: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 50 },
  }, ["query"]),
  requiredScopes: ["school:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const like = "%" + input.query + "%";
    const result = await ctx.runtime.db.query(
      `SELECT s.id,s.admission_number AS "admissionNumber",s.student_number AS "studentNumber",
              s.first_name AS "firstName",s.middle_name AS "middleName",s.last_name AS "lastName",
              s.preferred_name AS "preferredName",s.status,s.current_class_id AS "classId",
              c.name AS "className",s.current_stream_id AS "streamId",st.name AS "streamName"
         FROM school_students s
         LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id
         LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id
        WHERE s.organization_id=$1 AND s.deleted_at IS NULL
          AND (s.id=$2 OR s.admission_number=$2 OR s.student_number=$2
               OR s.first_name ILIKE $3 OR s.middle_name ILIKE $3 OR s.last_name ILIKE $3
               OR concat_ws(' ',s.first_name,s.middle_name,s.last_name) ILIKE $3)
        ORDER BY CASE WHEN s.id=$2 OR s.admission_number=$2 OR s.student_number=$2 THEN 0 ELSE 1 END,
                 s.last_name,s.first_name
        LIMIT $4`,
      [ctx.principal.organizationId, input.query, like, cap(input.limit, 10, 50)],
    );
    return { students: result.rows };
  },
};

const guardianLookup: LedgerlyAiToolDefinition = {
  name: "guardian.lookup",
  category: "school",
  description: "Find guardians and the learners connected to them.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  inputJsonSchema: schema({
    query: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 50 },
  }, ["query"]),
  requiredScopes: ["school:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const like = "%" + input.query + "%";
    const result = await ctx.runtime.db.query(
      `SELECT g.id,g.first_name AS "firstName",g.middle_name AS "middleName",g.last_name AS "lastName",
              g.phone_primary AS "phonePrimary",g.email,g.relationship_default AS "relationshipDefault",
              COALESCE(jsonb_agg(jsonb_build_object(
                'studentId',s.id,'admissionNumber',s.admission_number,
                'studentName',concat_ws(' ',s.first_name,s.middle_name,s.last_name),
                'relationship',sg.relationship,'primaryGuardian',sg.primary_guardian
              )) FILTER (WHERE s.id IS NOT NULL),'[]'::jsonb) AS students
         FROM school_guardians g
         LEFT JOIN school_student_guardians sg
           ON sg.organization_id=g.organization_id AND sg.guardian_id=g.id
         LEFT JOIN school_students s
           ON s.organization_id=sg.organization_id AND s.id=sg.student_id AND s.deleted_at IS NULL
        WHERE g.organization_id=$1 AND g.active=true
          AND (g.id=$2 OR g.phone_primary=$2 OR g.email=$2
               OR g.first_name ILIKE $3 OR g.middle_name ILIKE $3 OR g.last_name ILIKE $3
               OR concat_ws(' ',g.first_name,g.middle_name,g.last_name) ILIKE $3)
        GROUP BY g.id
        ORDER BY g.last_name,g.first_name
        LIMIT $4`,
      [ctx.principal.organizationId, input.query, like, cap(input.limit, 10, 50)],
    );
    return { guardians: result.rows };
  },
};

const staffLookup: LedgerlyAiToolDefinition = {
  name: "staff.lookup",
  category: "school",
  description: "Find school staff by ID, staff number, name, phone, or email.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(200),
    teachersOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  inputJsonSchema: schema({
    query: { type: "string" },
    teachersOnly: { type: "boolean" },
    limit: { type: "integer", minimum: 1, maximum: 50 },
  }, ["query"]),
  requiredScopes: ["school:read", "hr:read"],
  scopeMode: "any",
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const like = "%" + input.query + "%";
    const result = await ctx.runtime.db.query(
      `SELECT s.id,s.staff_number AS "staffNumber",s.first_name AS "firstName",
              s.middle_name AS "middleName",s.last_name AS "lastName",s.phone,s.email,
              s.employment_status AS "employmentStatus",s.is_teacher AS "isTeacher",
              s.department_id AS "departmentId",s.position_id AS "positionId"
         FROM school_staff_profiles s
        WHERE s.organization_id=$1 AND s.deleted_at IS NULL
          AND ($4::boolean=false OR s.is_teacher=true)
          AND (s.id=$2 OR s.staff_number=$2 OR s.phone=$2 OR s.email=$2
               OR s.first_name ILIKE $3 OR s.middle_name ILIKE $3 OR s.last_name ILIKE $3
               OR concat_ws(' ',s.first_name,s.middle_name,s.last_name) ILIKE $3)
        ORDER BY s.last_name,s.first_name LIMIT $5`,
      [ctx.principal.organizationId, input.query, like, input.teachersOnly ?? false, cap(input.limit, 10, 50)],
    );
    return { staff: result.rows };
  },
};

const attendanceRead: LedgerlyAiToolDefinition = {
  name: "attendance.read",
  category: "attendance",
  description: "Read learner attendance records and status counts for a learner or class/date range.",
  inputSchema: z.object({
    studentId: z.string().max(160).optional(),
    classId: z.string().max(160).optional(),
    from: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
    to: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }).refine((value) => Boolean(value.studentId || value.classId), "studentId or classId is required"),
  inputJsonSchema: schema({
    studentId: { type: "string" },
    classId: { type: "string" },
    from: { type: "string", format: "date" },
    to: { type: "string", format: "date" },
    limit: { type: "integer", minimum: 1, maximum: 200 },
  }),
  requiredScopes: ["school:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const result = await ctx.runtime.db.query(
      `SELECT r.id,r.student_id AS "studentId",s.admission_number AS "admissionNumber",
              concat_ws(' ',s.first_name,s.middle_name,s.last_name) AS "studentName",
              se.attendance_date AS "attendanceDate",se.session_type AS "sessionType",
              se.class_id AS "classId",se.stream_id AS "streamId",r.status,
              r.minutes_late AS "minutesLate",r.notes
         FROM school_student_attendance_records r
         JOIN school_student_attendance_sessions se
           ON se.id=r.session_id AND se.organization_id=r.organization_id
         JOIN school_students s
           ON s.id=r.student_id AND s.organization_id=r.organization_id
        WHERE r.organization_id=$1
          AND ($2::text IS NULL OR r.student_id=$2)
          AND ($3::text IS NULL OR se.class_id=$3)
          AND ($4::date IS NULL OR se.attendance_date >= $4::date)
          AND ($5::date IS NULL OR se.attendance_date <= $5::date)
        ORDER BY se.attendance_date DESC,r.created_at DESC
        LIMIT $6`,
      [ctx.principal.organizationId,input.studentId ?? null,input.classId ?? null,input.from ?? null,input.to ?? null,cap(input.limit,50,200)],
    );
    const summary: Record<string, number> = {};
    for (const row of result.rows as Array<{ status?: unknown }>) {
      const status = String(row.status ?? "unknown");
      summary[status] = (summary[status] ?? 0) + 1;
    }
    return { summary, records: result.rows };
  },
};

const academicsRead: LedgerlyAiToolDefinition = {
  name: "academics.read",
  category: "academics",
  description: "Read lesson plans and actual lesson-delivery records for academic supervision.",
  inputSchema: z.object({
    teacherStaffId: z.string().max(160).optional(),
    classId: z.string().max(160).optional(),
    subjectId: z.string().max(160).optional(),
    from: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
    to: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  inputJsonSchema: schema({
    teacherStaffId: { type: "string" },
    classId: { type: "string" },
    subjectId: { type: "string" },
    from: { type: "string", format: "date" },
    to: { type: "string", format: "date" },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }),
  requiredScopes: ["school:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const args = [
      ctx.principal.organizationId,input.teacherStaffId ?? null,input.classId ?? null,
      input.subjectId ?? null,input.from ?? null,input.to ?? null,cap(input.limit,30,100),
    ];
    const [plans, deliveries] = await Promise.all([
      ctx.runtime.db.query(
        `SELECT p.id,p.lesson_date AS "lessonDate",p.teacher_staff_id AS "teacherStaffId",
                p.class_id AS "classId",p.subject_id AS "subjectId",p.topic,p.subtopic,p.status,
                p.learning_outcomes AS "learningOutcomes",p.review_notes AS "reviewNotes"
           FROM school_lesson_plans p
          WHERE p.organization_id=$1
            AND ($2::text IS NULL OR p.teacher_staff_id=$2)
            AND ($3::text IS NULL OR p.class_id=$3)
            AND ($4::text IS NULL OR p.subject_id=$4)
            AND ($5::date IS NULL OR p.lesson_date >= $5::date)
            AND ($6::date IS NULL OR p.lesson_date <= $6::date)
          ORDER BY p.lesson_date DESC,p.updated_at DESC LIMIT $7`, args),
      ctx.runtime.db.query(
        `SELECT d.id,d.delivered_on AS "deliveredOn",d.teacher_staff_id AS "teacherStaffId",
                d.class_id AS "classId",d.subject_id AS "subjectId",d.topic,d.subtopic,
                d.periods_delivered AS "periodsDelivered",d.learning_outcomes_covered AS "learningOutcomesCovered",
                d.challenges,d.next_steps AS "nextSteps"
           FROM school_academic_delivery_logs d
          WHERE d.organization_id=$1
            AND ($2::text IS NULL OR d.teacher_staff_id=$2)
            AND ($3::text IS NULL OR d.class_id=$3)
            AND ($4::text IS NULL OR d.subject_id=$4)
            AND ($5::date IS NULL OR d.delivered_on >= $5::date)
            AND ($6::date IS NULL OR d.delivered_on <= $6::date)
          ORDER BY d.delivered_on DESC,d.updated_at DESC LIMIT $7`, args),
    ]);
    return { lessonPlans: plans.rows, deliveries: deliveries.rows };
  },
};

export const schoolTools: LedgerlyAiToolDefinition[] = [
  studentLookup, guardianLookup, staffLookup, attendanceRead, academicsRead,
];
