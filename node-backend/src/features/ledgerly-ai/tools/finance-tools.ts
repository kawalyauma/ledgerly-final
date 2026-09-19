import { z } from "zod";
import type { LedgerlyAiToolDefinition } from "./types.js";

function schema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}
function cap(value: number | undefined, fallback: number, max: number) {
  return Math.min(Math.max(value ?? fallback, 1), max);
}

const feesRead: LedgerlyAiToolDefinition = {
  name: "fees.read",
  category: "finance",
  description: "Read a learner's fee charges, receipts, and current outstanding balance.",
  inputSchema: z.object({ studentId: z.string().min(1).max(160) }),
  inputJsonSchema: schema({ studentId: { type: "string" } }, ["studentId"]),
  requiredScopes: ["school:read", "accounts:read", "payments:read"],
  scopeMode: "any",
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const [student, charges, receipts] = await Promise.all([
      ctx.runtime.db.query(
        `SELECT id,admission_number AS "admissionNumber",
                concat_ws(' ',first_name,middle_name,last_name) AS name
           FROM school_students
          WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL`,
        [ctx.principal.organizationId, input.studentId],
      ),
      ctx.runtime.db.query(
        `SELECT c.id,c.amount_minor AS "amountMinor",c.due_date AS "dueDate",
                d.number AS "documentNumber",d.status,d.total_minor AS "documentTotalMinor",
                d.paid_minor AS "paidMinor",GREATEST(d.total_minor-d.paid_minor,0) AS "outstandingMinor"
           FROM school_student_fee_charges c
           JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
          WHERE c.organization_id=$1 AND c.student_id=$2
          ORDER BY c.created_at DESC LIMIT 200`,
        [ctx.principal.organizationId, input.studentId],
      ),
      ctx.runtime.db.query(
        `SELECT receipt_number AS "receiptNumber",amount_minor AS "amountMinor",
                payment_date AS "paymentDate",reference
           FROM school_fee_receipts
          WHERE organization_id=$1 AND student_id=$2
          ORDER BY payment_date DESC,created_at DESC LIMIT 100`,
        [ctx.principal.organizationId, input.studentId],
      ),
    ]);
    if (!student.rows[0]) return { found: false };
    const outstandingMinor = (charges.rows as Array<{ outstandingMinor?: unknown }>)
      .reduce((sum, row) => sum + Number(row.outstandingMinor ?? 0), 0);
    return { found: true, student: student.rows[0], outstandingMinor, charges: charges.rows, receipts: receipts.rows };
  },
};

const financeRead: LedgerlyAiToolDefinition = {
  name: "finance.read",
  category: "finance",
  description: "Read finance summary, account balances, and recent journals.",
  inputSchema: z.object({
    mode: z.enum(["summary","accounts","journals"]).default("summary"),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  inputJsonSchema: schema({
    mode: { type: "string", enum: ["summary","accounts","journals"] },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }),
  requiredScopes: ["accounts:read", "reports:read"],
  scopeMode: "any",
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    if (input.mode === "journals") {
      const result = await ctx.runtime.db.query(
        `SELECT j.id,j.entry_number AS "entryNumber",j.posting_date AS "postingDate",
                j.description,j.reference,j.status,j.currency,
                COALESCE(SUM(l.debit_minor),0) AS "debitMinor",
                COALESCE(SUM(l.credit_minor),0) AS "creditMinor"
           FROM journal_entries j
           LEFT JOIN journal_lines l
             ON l.organization_id=j.organization_id AND l.journal_entry_id=j.id
          WHERE j.organization_id=$1
          GROUP BY j.id
          ORDER BY j.posting_date DESC,j.created_at DESC LIMIT $2`,
        [ctx.principal.organizationId, cap(input.limit, 30, 100)],
      );
      return { journals: result.rows };
    }
    const result = await ctx.runtime.db.query(
      `SELECT a.id,a.code,a.name,a.type,
              COALESCE(SUM(CASE WHEN j.status='posted'
                THEN l.base_debit_minor-l.base_credit_minor ELSE 0 END),0) AS "netDebitMinor"
         FROM accounts a
         LEFT JOIN journal_lines l
           ON l.organization_id=a.organization_id AND l.account_id=a.id
         LEFT JOIN journal_entries j
           ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
        WHERE a.organization_id=$1 AND a.active=true
        GROUP BY a.id ORDER BY a.code LIMIT $2`,
      [ctx.principal.organizationId, input.mode === "accounts" ? cap(input.limit, 100, 100) : 30],
    );
    if (input.mode === "accounts") return { accounts: result.rows };
    const summary: Record<string, number> = {};
    for (const row of result.rows as Array<{ type?: unknown; netDebitMinor?: unknown }>) {
      const type = String(row.type ?? "unknown");
      summary[type] = (summary[type] ?? 0) + Number(row.netDebitMinor ?? 0);
    }
    return { accountTypeNetDebitMinor: summary, accountsSample: result.rows.slice(0, 20) };
  },
};

const payrollRead: LedgerlyAiToolDefinition = {
  name: "payroll.read",
  category: "payroll",
  description: "Read payroll run totals and employee payroll lines.",
  inputSchema: z.object({
    runId: z.string().max(160).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  inputJsonSchema: schema({
    runId: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  }),
  requiredScopes: ["payroll:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    if (input.runId) {
      const result = await ctx.runtime.db.query(
        `SELECT l.id,l.employee_id AS "employeeId",e.employee_number AS "employeeNumber",
                l.gross_minor AS "grossMinor",l.deductions_minor AS "deductionsMinor",
                l.net_minor AS "netMinor",l.paid_minor AS "paidMinor",
                l.balance_minor AS "balanceMinor",l.payment_status AS "paymentStatus"
           FROM payroll_lines l
           JOIN payroll_employees e ON e.id=l.employee_id AND e.organization_id=l.organization_id
          WHERE l.organization_id=$1 AND l.payroll_run_id=$2
          ORDER BY e.employee_number LIMIT $3`,
        [ctx.principal.organizationId, input.runId, cap(input.limit, 100, 100)],
      );
      return { runId: input.runId, lines: result.rows };
    }
    const result = await ctx.runtime.db.query(
      `SELECT id,number,period_start AS "periodStart",period_end AS "periodEnd",
              pay_date AS "payDate",currency,status,gross_minor AS "grossMinor",
              deductions_minor AS "deductionsMinor",net_minor AS "netMinor"
         FROM payroll_runs WHERE organization_id=$1
        ORDER BY pay_date DESC,created_at DESC LIMIT $2`,
      [ctx.principal.organizationId, cap(input.limit, 20, 100)],
    );
    return { runs: result.rows };
  },
};

const reportGenerate: LedgerlyAiToolDefinition = {
  name: "report.generate",
  category: "reporting",
  description: "Generate structured Ledgerly report data for school, attendance, fees, finance, payroll, or academics.",
  inputSchema: z.object({
    reportType: z.enum(["school_snapshot","attendance","academics","fees","finance","payroll"]),
  }),
  inputJsonSchema: schema({
    reportType: { type: "string", enum: ["school_snapshot","attendance","academics","fees","finance","payroll"] },
  }, ["reportType"]),
  requiredScopes: ["reports:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const org = ctx.principal.organizationId;
    if (input.reportType === "school_snapshot") {
      const r = await ctx.runtime.db.query(
        `SELECT
          (SELECT COUNT(*) FROM school_students s WHERE s.organization_id=$1 AND s.deleted_at IS NULL AND s.status='active')::int AS "activeStudents",
          (SELECT COUNT(*) FROM school_staff_profiles s WHERE s.organization_id=$1 AND s.deleted_at IS NULL AND s.employment_status='active')::int AS "activeStaff",
          (SELECT COUNT(*) FROM school_guardians g WHERE g.organization_id=$1 AND g.active=true)::int AS guardians,
          (SELECT COUNT(*) FROM school_classes c WHERE c.organization_id=$1 AND c.active=true)::int AS classes`,
        [org],
      );
      return { reportType: input.reportType, generatedAt: new Date().toISOString(), data: r.rows[0] };
    }
    if (input.reportType === "attendance") {
      const r = await ctx.runtime.db.query(
        `SELECT r.status,COUNT(*)::int AS count
           FROM school_student_attendance_records r
           JOIN school_student_attendance_sessions s
             ON s.id=r.session_id AND s.organization_id=r.organization_id
          WHERE r.organization_id=$1 AND s.attendance_date>=CURRENT_DATE-INTERVAL '30 days'
          GROUP BY r.status ORDER BY r.status`,
        [org],
      );
      return { reportType: input.reportType, windowDays: 30, data: r.rows };
    }
    if (input.reportType === "academics") {
      const r = await ctx.runtime.db.query(
        `SELECT
          (SELECT COUNT(*) FROM school_lesson_plans p WHERE p.organization_id=$1 AND p.status='submitted')::int AS "submittedPlans",
          (SELECT COUNT(*) FROM school_lesson_plans p WHERE p.organization_id=$1 AND p.status='approved')::int AS "approvedPlans",
          (SELECT COUNT(*) FROM school_academic_delivery_logs d WHERE d.organization_id=$1 AND d.delivered_on>=CURRENT_DATE-INTERVAL '30 days')::int AS "deliveriesLast30Days"`,
        [org],
      );
      return { reportType: input.reportType, data: r.rows[0] };
    }
    if (input.reportType === "fees") {
      const r = await ctx.runtime.db.query(
        `SELECT COALESCE(SUM(d.total_minor),0)::bigint AS "billedMinor",
                COALESCE(SUM(d.paid_minor),0)::bigint AS "paidMinor",
                COALESCE(SUM(GREATEST(d.total_minor-d.paid_minor,0)),0)::bigint AS "outstandingMinor"
           FROM documents d
          WHERE d.organization_id=$1 AND d.type='invoice' AND d.status IN ('open','partially_paid','paid')`,
        [org],
      );
      return { reportType: input.reportType, data: r.rows[0] };
    }
    if (input.reportType === "payroll") {
      const r = await ctx.runtime.db.query(
        `SELECT COUNT(*)::int AS runs,COALESCE(SUM(gross_minor),0)::bigint AS "grossMinor",
                COALESCE(SUM(deductions_minor),0)::bigint AS "deductionsMinor",
                COALESCE(SUM(net_minor),0)::bigint AS "netMinor"
           FROM payroll_runs WHERE organization_id=$1 AND pay_date>=CURRENT_DATE-INTERVAL '90 days'`,
        [org],
      );
      return { reportType: input.reportType, windowDays: 90, data: r.rows[0] };
    }
    const r = await ctx.runtime.db.query(
      `SELECT a.type,COUNT(DISTINCT a.id)::int AS accounts,
              COALESCE(SUM(CASE WHEN j.status='posted'
                THEN l.base_debit_minor-l.base_credit_minor ELSE 0 END),0)::bigint AS "netDebitMinor"
         FROM accounts a
         LEFT JOIN journal_lines l ON l.organization_id=a.organization_id AND l.account_id=a.id
         LEFT JOIN journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
        WHERE a.organization_id=$1 AND a.active=true
        GROUP BY a.type ORDER BY a.type`,
      [org],
    );
    return { reportType: input.reportType, data: r.rows };
  },
};

export const financeTools: LedgerlyAiToolDefinition[] = [
  feesRead, financeRead, payrollRead, reportGenerate,
];
