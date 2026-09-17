import { createId } from "./shared.js";
import type { AgentKey } from "./policy.js";
import { resolveGuardianFamily, type FamilyGenderFilter } from "./family-resolver.js";
import { cumulativeAcademicSection, cumulativeAttendanceSection, cumulativeFinanceSection } from "./family-sections.js";

export type FamilyReportOptions = {
  guardianQuery: string;
  studentGender?: FamilyGenderFilter;
  includeAcademic?: boolean;
  includeAttendance?: boolean;
  includeFinance?: boolean;
  maxExamHistory?: number;
};

export async function buildFamilyReport(
  db: D1Database,
  organizationId: string,
  conversationId: string | null,
  createdBy: string,
  requestedAgentKey: AgentKey,
  options: FamilyReportOptions,
) {
  const gender = options.studentGender || "all";
  const family = await resolveGuardianFamily(db, organizationId, options.guardianQuery, gender);
  if (!family.found || family.ambiguous || !family.guardian) return { family, report: null, reportId: null };

  const includeAcademic = options.includeAcademic !== false;
  const includeAttendance = options.includeAttendance !== false;
  const includeFinance = options.includeFinance !== false;
  const organization = await db.prepare("SELECT name,base_currency AS baseCurrency FROM organizations WHERE id=?")
    .bind(organizationId).first<{ name?: string; baseCurrency?: string }>();
  const studentReports: Array<Record<string, unknown>> = [];

  for (const student of family.students) {
    const [academic, attendance, finance] = await Promise.all([
      includeAcademic ? cumulativeAcademicSection(db, organizationId, String(student.id), options.maxExamHistory || 24) : Promise.resolve(null),
      includeAttendance ? cumulativeAttendanceSection(db, organizationId, String(student.id)) : Promise.resolve(null),
      includeFinance ? cumulativeFinanceSection(db, organizationId, String(student.id)) : Promise.resolve(null),
    ]);
    studentReports.push({ student, academic, attendance, finance });
  }

  const familyFinance = includeFinance ? studentReports.reduce((acc, item) => {
    const totals = (item.finance as any)?.totals || {};
    acc.billedMinor += Number(totals.billedMinor || 0);
    acc.creditedMinor += Number(totals.creditedMinor || 0);
    acc.writtenOffMinor += Number(totals.writtenOffMinor || 0);
    acc.paidMinor += Number(totals.paidMinor || 0);
    acc.outstandingMinor += Number(totals.outstandingMinor || 0);
    return acc;
  }, { billedMinor: 0, creditedMinor: 0, writtenOffMinor: 0, paidMinor: 0, outstandingMinor: 0 }) : null;

  const report = {
    generatedAt: new Date().toISOString(),
    organization: { id: organizationId, name: organization?.name || null, currency: organization?.baseCurrency || "UGX" },
    moneyUnit: "minor",
    dataPolicy: {
      guardianResolution: "verified school_student_guardians links only",
      academics: includeAcademic ? "published exam/report-card evidence only" : "excluded",
      attendance: includeAttendance ? "official attendance records only" : "excluded",
      finance: includeFinance ? "posted fee charges and non-reversed payment allocations" : "excluded",
    },
    guardian: family.guardian,
    filter: { gender },
    linkedStudentCount: family.linkedStudentCount,
    includedStudentCount: family.students.length,
    students: studentReports,
    familyFinance,
  };

  const reportId = createId("afr");
  await db.prepare(`
    INSERT INTO ae_family_reports
      (id,organization_id,conversation_id,created_by,requested_agent_key,guardian_id,guardian_query,student_filter_json,snapshot_json)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).bind(
    reportId,
    organizationId,
    conversationId,
    createdBy,
    requestedAgentKey,
    String((family.guardian as any).id),
    options.guardianQuery,
    JSON.stringify({ gender, includeAcademic, includeAttendance, includeFinance, maxExamHistory: options.maxExamHistory || 24 }),
    JSON.stringify(report),
  ).run();

  return { family, report, reportId };
}
