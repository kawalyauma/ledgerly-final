import { createId } from "./shared.js";
import type { AuthPrincipal } from "./shared.js";
import type { AgentDefinition } from "./policy.js";
import { hasScope, isToolAllowed } from "./policy.js";

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
  school_snapshot: { name: "school_snapshot", description: "Get high-level counts for this school organization.", parameters: objectSchema({}) },
  search_students: {
    name: "search_students",
    description: "Search students in this school by name, admission number or student number.",
    parameters: objectSchema({ query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, ["query"]),
  },
  search_staff: {
    name: "search_staff",
    description: "Search staff in this school by name or staff number.",
    parameters: objectSchema({ query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, ["query"]),
  },
  academics_overview: { name: "academics_overview", description: "Get current academic supervision counts and average scheme coverage.", parameters: objectSchema({}) },
  lesson_plan_queue: {
    name: "lesson_plan_queue",
    description: "List recent lesson plans for DOS supervision, optionally filtered by status.",
    parameters: objectSchema({ status: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }),
  },
  scheme_coverage: {
    name: "scheme_coverage",
    description: "List schemes of work at or below a coverage percentage to identify syllabus-coverage risks.",
    parameters: objectSchema({ maximumCoveragePercent: { type: "number", minimum: 0, maximum: 100 }, limit: { type: "integer", minimum: 1, maximum: 50 } }),
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
  fee_collection_summary: { name: "fee_collection_summary", description: "Get billed, paid, credited, written-off and outstanding school-fee totals.", parameters: objectSchema({}) },
  hr_overview: { name: "hr_overview", description: "Get workforce, departments, pending leave and onboarding summary.", parameters: objectSchema({}) },
  hr_leave_queue: {
    name: "hr_leave_queue",
    description: "List recent leave requests, optionally filtered by status. This tool never approves or rejects leave.",
    parameters: objectSchema({ status: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }),
  },
  books_overview: { name: "books_overview", description: "Get writing-book stock and distribution totals by book type.", parameters: objectSchema({}) },
  learner_book_history: {
    name: "learner_book_history",
    description: "Find a learner and return recent writing-book distributions recorded for that learner.",
    parameters: objectSchema({ query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["query"]),
  },
  communications_summary: { name: "communications_summary", description: "Get communication campaign and delivery health for this organization.", parameters: objectSchema({}) },
  prepare_communication: {
    name: "prepare_communication",
    description: "Prepare a Ledgerly SMS/WhatsApp communication campaign for human approval. It does not send anything by itself.",
    parameters: objectSchema({
      audienceKind: { type: "string", enum: ["students", "staff", "fee_balances"] },
      channels: { type: "array", items: { type: "string", enum: ["sms", "whatsapp"] }, minItems: 1, maxItems: 2 },
      subject: { type: "string" },
      message: { type: "string" },
      studentIds: { type: "array", items: { type: "string" }, maxItems: 200 },
      staffIds: { type: "array", items: { type: "string" }, maxItems: 200 },
      recipientMode: { type: "string", enum: ["primary_guardian", "all_guardians", "student_direct", "guardians_and_student"] },
      minimumBalanceMinor: { type: "integer", minimum: 0 },
    }, ["audienceKind", "channels", "subject", "message"]),
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
    .map(spec => ({ type: "function", name: spec.name, description: spec.description, parameters: spec.parameters, strict: true }));
}

async function findStudent(db: D1Database, organizationId: string, value: string) {
  const like = `%${value}%`;
  return db.prepare(`
    SELECT id, admission_number AS admissionNumber, student_number AS studentNumber,
           first_name AS firstName, middle_name AS middleName, last_name AS lastName,
           current_class_id AS classId, current_stream_id AS streamId
    FROM school_students
    WHERE organization_id=? AND deleted_at IS NULL
      AND (id=? OR admission_number=? OR student_number=? OR (first_name || ' ' || last_name) LIKE ?)
    ORDER BY CASE WHEN id=? OR admission_number=? OR student_number=? THEN 0 ELSE 1 END, last_name
    LIMIT 1
  `).bind(organizationId, value, value, value, like, value, value, value).first<Record<string, unknown>>();
}

export async function executeTool(ctx: ToolContext, name: string, raw: unknown) {
  if (!isToolAllowed(ctx.agent, name, ctx.requestedTools)) throw new Error(`Tool ${name} is not allowed for ${ctx.agent.key}`);
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
      return { activeStudents: Number(students?.n || 0), activeStaff: Number(staff?.n || 0), activeGuardians: Number(guardians?.n || 0), activeClasses: Number(classes?.n || 0) };
    }

    case "search_students": {
      need(ctx, "school:read");
      const query = `%${String(args.query || "").trim()}%`, limit = clampLimit(args.limit);
      const rows = await ctx.db.prepare(`
        SELECT id, admission_number AS admissionNumber, student_number AS studentNumber,
               first_name AS firstName, middle_name AS middleName, last_name AS lastName,
               status, current_class_id AS classId, current_stream_id AS streamId
        FROM school_students WHERE organization_id=? AND deleted_at IS NULL
          AND (admission_number LIKE ? OR student_number LIKE ? OR first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?)
        ORDER BY last_name, first_name LIMIT ?
      `).bind(organizationId, query, query, query, query, query, query, limit).all();
      return { students: rows.results };
    }

    case "search_staff": {
      need(ctx, "school:read");
      const query = `%${String(args.query || "").trim()}%`, limit = clampLimit(args.limit);
      const rows = await ctx.db.prepare(`
        SELECT id, staff_number AS staffNumber, first_name AS firstName, middle_name AS middleName,
               last_name AS lastName, employment_status AS employmentStatus, department_id AS departmentId, position_id AS positionId
        FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL
          AND (staff_number LIKE ? OR first_name LIKE ? OR middle_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?)
        ORDER BY last_name, first_name LIMIT ?
      `).bind(organizationId, query, query, query, query, query, limit).all();
      return { staff: rows.results };
    }

    case "academics_overview": {
      need(ctx, "school:read");
      const [timetables, schemes, plans, deliveries, observations, inspections, coverage] = await Promise.all([
        ctx.db.prepare("SELECT COUNT(*) AS n FROM acad_timetables WHERE organization_id=? AND status IN ('draft','submitted','approved','published')").bind(organizationId).first<any>(),
        ctx.db.prepare("SELECT COUNT(*) AS n FROM acad_schemes WHERE organization_id=? AND status<>'archived'").bind(organizationId).first<any>(),
        ctx.db.prepare("SELECT COUNT(*) AS n FROM acad_lesson_plans WHERE organization_id=? AND status<>'delivered'").bind(organizationId).first<any>(),
        ctx.db.prepare("SELECT COUNT(*) AS n FROM acad_lesson_deliveries WHERE organization_id=? AND scheduled_date=date('now')").bind(organizationId).first<any>(),
        ctx.db.prepare("SELECT COUNT(*) AS n FROM acad_observations WHERE organization_id=? AND status<>'closed'").bind(organizationId).first<any>(),
        ctx.db.prepare("SELECT COUNT(*) AS n FROM acad_inspections WHERE organization_id=? AND status<>'closed'").bind(organizationId).first<any>(),
        ctx.db.prepare("SELECT ROUND(AVG(coverage_percent),1) AS pct FROM acad_schemes WHERE organization_id=? AND status<>'archived'").bind(organizationId).first<any>(),
      ]);
      return { timetables: Number(timetables?.n || 0), schemes: Number(schemes?.n || 0), lessonPlans: Number(plans?.n || 0), todaysLessons: Number(deliveries?.n || 0), openObservations: Number(observations?.n || 0), openInspections: Number(inspections?.n || 0), averageCoverage: Number(coverage?.pct || 0) };
    }

    case "lesson_plan_queue": {
      need(ctx, "school:read");
      const status = String(args.status || "").trim() || null, limit = clampLimit(args.limit, 20, 50);
      const rows = await ctx.db.prepare(`
        SELECT p.id,p.lesson_date AS lessonDate,p.topic,p.subtopic,p.status,c.name AS className,s.name AS subjectName,
               TRIM(sp.first_name||' '||sp.last_name) AS teacherName,p.hod_feedback AS hodFeedback,p.updated_at AS updatedAt
        FROM acad_lesson_plans p JOIN school_classes c ON c.id=p.class_id JOIN school_subjects s ON s.id=p.subject_id
        LEFT JOIN school_staff_profiles sp ON sp.organization_id=p.organization_id AND sp.user_id=p.teacher_user_id
        WHERE p.organization_id=? AND (? IS NULL OR p.status=?) ORDER BY p.updated_at DESC LIMIT ?
      `).bind(organizationId, status, status, limit).all();
      return { lessonPlans: rows.results };
    }

    case "scheme_coverage": {
      need(ctx, "school:read");
      const max = Math.max(0, Math.min(100, Number(args.maximumCoveragePercent ?? 80))), limit = clampLimit(args.limit, 20, 50);
      const rows = await ctx.db.prepare(`
        SELECT s.id,s.title,s.status,s.coverage_percent AS coveragePercent,c.name AS className,su.name AS subjectName,
               TRIM(sp.first_name||' '||sp.last_name) AS teacherName,t.name AS termName,ay.name AS academicYearName
        FROM acad_schemes s JOIN school_classes c ON c.id=s.class_id JOIN school_subjects su ON su.id=s.subject_id
        JOIN school_terms t ON t.id=s.term_id JOIN school_academic_years ay ON ay.id=s.academic_year_id
        LEFT JOIN school_staff_profiles sp ON sp.organization_id=s.organization_id AND sp.user_id=s.teacher_user_id
        WHERE s.organization_id=? AND s.status<>'archived' AND COALESCE(s.coverage_percent,0)<=?
        ORDER BY COALESCE(s.coverage_percent,0),s.updated_at DESC LIMIT ?
      `).bind(organizationId, max, limit).all();
      return { maximumCoveragePercent: max, schemes: rows.results };
    }

    case "fee_balance_lookup": {
      need(ctx, "school:read");
      const value = String(args.query || "").trim(), student = await findStudent(ctx.db, organizationId, value);
      if (!student) return { found: false };
      const balance = await ctx.db.prepare(`
        SELECT COALESCE(SUM(c.total_minor-c.credited_minor-c.written_off_minor-COALESCE(p.paid_minor,0)),0) AS balanceMinor,COUNT(*) AS chargeCount
        FROM school_student_fee_charges c JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
        LEFT JOIN (SELECT organization_id,document_id,SUM(amount_minor) AS paid_minor FROM payment_allocations WHERE reversed_at IS NULL GROUP BY organization_id,document_id) p
          ON p.organization_id=c.organization_id AND p.document_id=c.document_id
        WHERE c.organization_id=? AND c.student_id=? AND c.status<>'voided' AND d.status IN ('open','partially_paid','paid')
      `).bind(organizationId, String(student.id)).first<any>();
      return { found: true, student, balanceMinor: Number(balance?.balanceMinor || 0), chargeCount: Number(balance?.chargeCount || 0) };
    }

    case "fee_arrears_summary": {
      need(ctx, "school:read");
      const limit = clampLimit(args.limit, 10, 30);
      const rows = await ctx.db.prepare(`
        SELECT s.id,s.admission_number AS admissionNumber,s.first_name||' '||s.last_name AS studentName,
               ROUND(SUM(c.total_minor-c.credited_minor-c.written_off_minor-COALESCE(p.paid_minor,0))) AS balanceMinor
        FROM school_student_fee_charges c JOIN school_students s ON s.id=c.student_id AND s.organization_id=c.organization_id
        JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
        LEFT JOIN (SELECT organization_id,document_id,SUM(amount_minor) AS paid_minor FROM payment_allocations WHERE reversed_at IS NULL GROUP BY organization_id,document_id) p
          ON p.organization_id=c.organization_id AND p.document_id=c.document_id
        WHERE c.organization_id=? AND c.status<>'voided' AND d.status IN ('open','partially_paid','paid') GROUP BY s.id
        HAVING SUM(c.total_minor-c.credited_minor-c.written_off_minor-COALESCE(p.paid_minor,0))>0 ORDER BY balanceMinor DESC LIMIT ?
      `).bind(organizationId, limit).all();
      return { arrears: rows.results };
    }

    case "fee_collection_summary": {
      need(ctx, "school:read");
      const row = await ctx.db.prepare(`
        SELECT COALESCE(SUM(c.total_minor),0) AS billedMinor,COALESCE(SUM(c.credited_minor),0) AS creditedMinor,
               COALESCE(SUM(c.written_off_minor),0) AS writtenOffMinor,COALESCE(SUM(COALESCE(p.paid_minor,0)),0) AS paidMinor,
               COALESCE(SUM(c.total_minor-c.credited_minor-c.written_off_minor-COALESCE(p.paid_minor,0)),0) AS outstandingMinor
        FROM school_student_fee_charges c JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
        LEFT JOIN (SELECT organization_id,document_id,SUM(amount_minor) AS paid_minor FROM payment_allocations WHERE reversed_at IS NULL GROUP BY organization_id,document_id) p
          ON p.organization_id=c.organization_id AND p.document_id=c.document_id
        WHERE c.organization_id=? AND c.status<>'voided' AND d.status IN ('open','partially_paid','paid')
      `).bind(organizationId).first<any>();
      return { billedMinor: Number(row?.billedMinor || 0), paidMinor: Number(row?.paidMinor || 0), creditedMinor: Number(row?.creditedMinor || 0), writtenOffMinor: Number(row?.writtenOffMinor || 0), outstandingMinor: Number(row?.outstandingMinor || 0) };
    }

    case "hr_overview": {
      need(ctx, "hr:read");
      const [employees, departments, leave, onboarding] = await Promise.all([
        ctx.db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN employment_status='active' THEN 1 ELSE 0 END) AS active FROM hr_employees WHERE organization_id=?").bind(organizationId).first<any>(),
        ctx.db.prepare("SELECT COUNT(*) AS total FROM hr_departments WHERE organization_id=? AND active=1").bind(organizationId).first<any>(),
        ctx.db.prepare("SELECT COUNT(*) AS total FROM hr_leave_requests WHERE organization_id=? AND status='pending'").bind(organizationId).first<any>(),
        ctx.db.prepare("SELECT COUNT(*) AS total FROM hr_onboarding_tasks WHERE organization_id=? AND status='pending'").bind(organizationId).first<any>(),
      ]);
      return { employees: Number(employees?.total || 0), activeEmployees: Number(employees?.active || 0), departments: Number(departments?.total || 0), pendingLeave: Number(leave?.total || 0), pendingOnboarding: Number(onboarding?.total || 0) };
    }

    case "hr_leave_queue": {
      need(ctx, "hr:read");
      const status = String(args.status || "").trim() || null, limit = clampLimit(args.limit, 20, 50);
      const rows = await ctx.db.prepare(`
        SELECT r.id,e.employee_number AS employeeNumber,COALESCE(c.name,u.display_name,sp.first_name||' '||sp.last_name) AS employeeName,
               t.name AS leaveType,r.starts_on AS startsOn,r.ends_on AS endsOn,r.days_micros/1000000.0 AS days,r.reason,r.status,r.created_at AS createdAt
        FROM hr_leave_requests r JOIN hr_employees e ON e.id=r.employee_id JOIN hr_leave_types t ON t.id=r.leave_type_id
        LEFT JOIN contacts c ON c.id=e.contact_id LEFT JOIN users u ON u.id=e.user_id LEFT JOIN school_staff_profiles sp ON sp.id=e.school_staff_id
        WHERE r.organization_id=? AND (? IS NULL OR r.status=?) ORDER BY r.created_at DESC LIMIT ?
      `).bind(organizationId, status, status, limit).all();
      return { leaveRequests: rows.results };
    }

    case "books_overview": {
      need(ctx, "school:read");
      const rows = await ctx.db.prepare(`
        WITH types AS (SELECT book_type FROM bks_stock_movements WHERE organization_id=? UNION SELECT book_type FROM bks_distributions WHERE organization_id=?),
        stock AS (SELECT book_type,SUM(quantity_delta) qty FROM bks_stock_movements WHERE organization_id=? AND reversed_at IS NULL GROUP BY book_type),
        issued AS (SELECT book_type,SUM(quantity) qty FROM bks_distributions WHERE organization_id=? AND reversed_at IS NULL GROUP BY book_type)
        SELECT t.book_type AS bookType,COALESCE(stock.qty,0) AS receivedAdjusted,COALESCE(issued.qty,0) AS distributed,
               COALESCE(stock.qty,0)-COALESCE(issued.qty,0) AS available
        FROM types t LEFT JOIN stock ON stock.book_type=t.book_type LEFT JOIN issued ON issued.book_type=t.book_type ORDER BY t.book_type
      `).bind(organizationId, organizationId, organizationId, organizationId).all();
      return { stock: rows.results };
    }

    case "learner_book_history": {
      need(ctx, "school:read");
      const value = String(args.query || "").trim(), student = await findStudent(ctx.db, organizationId, value), limit = clampLimit(args.limit, 20, 50);
      if (!student) return { found: false };
      const rows = await ctx.db.prepare(`
        SELECT d.id,d.book_type AS bookType,d.quantity,d.distributed_on AS distributedOn,d.source,d.notes,
               d.reversed_at AS reversedAt,y.name AS academicYearName,t.name AS termName
        FROM bks_distributions d LEFT JOIN school_academic_years y ON y.id=d.academic_year_id LEFT JOIN school_terms t ON t.id=d.term_id
        WHERE d.organization_id=? AND d.student_id=? ORDER BY d.distributed_on DESC,d.created_at DESC LIMIT ?
      `).bind(organizationId, String(student.id), limit).all();
      return { found: true, student, distributions: rows.results };
    }

    case "communications_summary": {
      need(ctx, "communications:read");
      const [campaigns, today] = await Promise.all([
        ctx.db.prepare("SELECT COUNT(*) AS campaigns,SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) AS scheduled,SUM(sent_count) AS sent,SUM(failed_count) AS failed FROM communication_campaigns WHERE organization_id=?").bind(organizationId).first<any>(),
        ctx.db.prepare("SELECT COUNT(*) AS deliveries,SUM(CASE WHEN status IN ('sent','delivered') THEN 1 ELSE 0 END) AS sent,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM communication_deliveries WHERE organization_id=? AND created_at>=date('now')").bind(organizationId).first<any>(),
      ]);
      return { campaigns: Number(campaigns?.campaigns || 0), scheduled: Number(campaigns?.scheduled || 0), sent: Number(campaigns?.sent || 0), failed: Number(campaigns?.failed || 0), todayDeliveries: Number(today?.deliveries || 0), todaySent: Number(today?.sent || 0), todayFailed: Number(today?.failed || 0) };
    }

    case "prepare_communication": {
      need(ctx, "school:read");
      const approvalId = createId("aap");
      const channels = Array.isArray(args.channels) ? [...new Set(args.channels.map(String).filter(x => x === "sms" || x === "whatsapp"))] : [];
      if (!channels.length) throw new Error("At least one supported communication channel is required");
      const audienceKind = String(args.audienceKind || "students");
      const payload = {
        audience: {
          kind: audienceKind,
          studentIds: Array.isArray(args.studentIds) ? args.studentIds.map(String).slice(0, 200) : [],
          staffIds: Array.isArray(args.staffIds) ? args.staffIds.map(String).slice(0, 200) : [],
          recipientMode: args.recipientMode ? String(args.recipientMode) : undefined,
          minimumBalanceMinor: args.minimumBalanceMinor == null ? undefined : Math.max(0, Number(args.minimumBalanceMinor)),
        },
        channels,
        subject: String(args.subject || "School update").slice(0, 200),
        message: String(args.message || "").slice(0, 2000),
      };
      await ctx.db.prepare(`
        INSERT INTO ae_approvals(id,organization_id,conversation_id,agent_key,requested_by,action_type,required_scope,payload_json,status)
        VALUES (?,?,?,?,?,?,?,?,'pending')
      `).bind(approvalId, organizationId, ctx.conversationId, ctx.agent.key, ctx.principal.userId, "communication.campaign.send", "communications:write", JSON.stringify(payload)).run();
      return { approvalId, status: "pending", action: "communication.campaign.send", message: "Campaign prepared. A human with communications:write must approve it before the executor can send it." };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
