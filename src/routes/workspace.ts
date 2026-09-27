import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../types";
import { requireScope } from "../lib/auth";
import { AppError } from "../lib/errors";

type Row = Record<string, unknown>;

const sectionsInput = z.object({
  showAll: z.boolean().optional(),
  sections: z.array(z.object({ key: z.string().min(1).max(160), visible: z.boolean() })).max(200).optional(),
});

const num = (value: unknown) => Number(value ?? 0) || 0;
const safe = async <T>(load: () => Promise<T>): Promise<T | null> => {
  try { return await load(); } catch { return null; }
};

async function overview(db: D1Database, organizationId: string) {
  const one = <T extends Row>(sql: string) => db.prepare(sql).bind(organizationId).first<T>();
  const all = async <T extends Row>(sql: string) => (await db.prepare(sql).bind(organizationId).all<T>()).results;
  const [students, staff, fees, collections, exams, attendance, finance, monthly, tasks, admissions] = await Promise.all([
    safe(async () => {
      const totals = await one<Row>(`SELECT COUNT(*) FILTER (WHERE status='active') active, COUNT(*) total,
        COUNT(*) FILTER (WHERE status='active' AND lower(gender)='male') male,
        COUNT(*) FILTER (WHERE status='active' AND lower(gender)='female') female
        FROM school_students WHERE organization_id=? AND deleted_at IS NULL`);
      const byClass = await all<Row>(`SELECT COALESCE(c.name,'Unassigned') label, COUNT(*) value FROM school_students s
        LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id
        WHERE s.organization_id=? AND s.deleted_at IS NULL AND s.status='active' GROUP BY 1 ORDER BY 1`);
      return { active: num(totals?.active), total: num(totals?.total), male: num(totals?.male), female: num(totals?.female), byClass: byClass.map(row => ({ label: String(row.label), value: num(row.value) })) };
    }),
    safe(async () => {
      const row = await one<Row>(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE is_teacher=1) teachers
        FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL AND employment_status='active'`);
      return { total: num(row?.total), teachers: num(row?.teachers) };
    }),
    safe(async () => {
      const row = await one<Row>(`SELECT COALESCE(SUM(l.debit_minor),0) billed,
        COALESCE(SUM(CASE WHEN j.source_type IN ('receipt','schoolpay_payment') THEN l.credit_minor ELSE 0 END),0) collected,
        COALESCE(SUM(l.debit_minor-l.credit_minor),0) outstanding
        FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
        JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
        WHERE l.organization_id=? AND j.status='posted'
        AND (a.subtype='school_fee_receivable' OR (a.subtype='receivable' AND json_extract(l.dimensions_json,'$.schoolStudentId') IS NOT NULL))`);
      const billed = num(row?.billed), collected = num(row?.collected);
      return { billedMinor: billed, collectedMinor: collected, outstandingMinor: num(row?.outstanding), collectionRate: billed ? collected / billed : 0 };
    }),
    safe(async () => (await all<Row>(`WITH RECURSIVE days(day) AS (
        SELECT date('now','-29 days') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day < date('now')
      ) SELECT day label, COALESCE(SUM(r.amount_minor),0) value FROM days
      LEFT JOIN school_fee_receipts r ON r.organization_id=? AND r.payment_date=day AND r.status='posted'
      GROUP BY day ORDER BY day`)).map(row => ({ label: String(row.label), value: num(row.value) }))),
    safe(async () => (await all<Row>(`SELECT status label, COUNT(*) value FROM exm_exams WHERE organization_id=? GROUP BY status ORDER BY 2 DESC`)).map(row => ({ label: String(row.label), value: num(row.value) }))),
    safe(async () => {
      const row = await one<Row>(`SELECT COUNT(*) marked,
        COUNT(*) FILTER (WHERE r.status IN ('present','late')) present,
        COUNT(*) FILTER (WHERE r.status='absent') absent
        FROM school_student_attendance_records r JOIN school_student_attendance_sessions s ON s.id=r.session_id AND s.organization_id=r.organization_id
        WHERE r.organization_id=? AND s.attendance_date=date('now')`);
      return { marked: num(row?.marked), present: num(row?.present), absent: num(row?.absent) };
    }),
    safe(async () => {
      const row = await one<Row>(`SELECT
        COALESCE(SUM(CASE WHEN a.type='revenue' THEN l.credit_minor-l.debit_minor END),0) revenue,
        COALESCE(SUM(CASE WHEN a.type='expense' THEN l.debit_minor-l.credit_minor END),0) expenses,
        COALESCE(SUM(CASE WHEN a.type='asset' AND a.subtype IN ('cash','bank') THEN l.debit_minor-l.credit_minor END),0) cash
        FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
        JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
        WHERE l.organization_id=? AND j.status='posted'`);
      return { revenueMinor: num(row?.revenue), expensesMinor: num(row?.expenses), cashMinor: num(row?.cash) };
    }),
    safe(async () => (await all<Row>(`WITH RECURSIVE months(month) AS (
        SELECT date('now','start of month','-5 months') UNION ALL SELECT date(month,'+1 month') FROM months WHERE month < date('now','start of month')
      ) SELECT strftime('%m/%Y',month) label,
        COALESCE(SUM(CASE WHEN a.type='revenue' THEN l.credit_minor-l.debit_minor END),0) revenue,
        COALESCE(SUM(CASE WHEN a.type='expense' THEN l.debit_minor-l.credit_minor END),0) expenses
        FROM months LEFT JOIN journal_entries j ON j.organization_id=? AND j.status='posted' AND date(j.transaction_date,'start of month')=month
        LEFT JOIN journal_lines l ON l.journal_entry_id=j.id AND l.organization_id=j.organization_id
        LEFT JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
        GROUP BY month ORDER BY month`)).map(row => ({ label: String(row.label), revenue: num(row.revenue), expenses: num(row.expenses) }))),
    safe(async () => {
      const row = await one<Row>(`SELECT COUNT(*) FILTER (WHERE status NOT IN ('done','cancelled')) open,
        COUNT(*) FILTER (WHERE status NOT IN ('done','cancelled') AND due_at < CURRENT_TIMESTAMP) overdue
        FROM work_tasks WHERE organization_id=? AND archived_at IS NULL`);
      return { open: num(row?.open), overdue: num(row?.overdue) };
    }),
    safe(async () => (await all<Row>(`SELECT status label, COUNT(*) value FROM school_admission_applications WHERE organization_id=? GROUP BY status ORDER BY 2 DESC`)).map(row => ({ label: String(row.label), value: num(row.value) }))),
  ]);
  return { generatedAt: new Date().toISOString(), students, staff, fees, collections, exams, attendance, finance, monthly, tasks, admissions };
}

export const workspaceRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

workspaceRoutes.get("/overview", async c => c.json({ data: await overview(c.env.FINANCE_DB, c.get("principal").organizationId) }));

workspaceRoutes.get("/navigation", async c => {
  const row = await c.env.FINANCE_DB.prepare("SELECT navigation_settings FROM organizations WHERE id=?").bind(c.get("principal").organizationId).first<{ navigation_settings: string | null }>();
  return c.json({ data: row?.navigation_settings ? JSON.parse(row.navigation_settings) : null });
});

workspaceRoutes.put("/navigation", requireScope("admin:write"), async c => {
  const parsed = sectionsInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid navigation settings", parsed.error.flatten());
  const principal = c.get("principal");
  if (!["owner", "admin"].includes(principal.role)) throw new AppError(403, "FORBIDDEN", "Only owners and administrators can change the navigation layout");
  const value = parsed.data.showAll ? { showAll: true } : { sections: parsed.data.sections ?? [] };
  await c.env.FINANCE_DB.prepare("UPDATE organizations SET navigation_settings=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(value), principal.organizationId).run();
  return c.json({ data: value });
});

workspaceRoutes.delete("/navigation", requireScope("admin:write"), async c => {
  const principal = c.get("principal");
  if (!["owner", "admin"].includes(principal.role)) throw new AppError(403, "FORBIDDEN", "Only owners and administrators can change the navigation layout");
  await c.env.FINANCE_DB.prepare("UPDATE organizations SET navigation_settings=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(principal.organizationId).run();
  return c.json({ data: null });
});
