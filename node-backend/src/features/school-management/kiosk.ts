import { Hono } from "hono";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { requireScope } from "../core-identity/security.js";

function camel(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
  return out;
}

/** Aggregate-only data for unattended displays. No student or staff identities leave this endpoint. */
export function createSchoolKioskRoutes(runtime: Runtime) {
  const routes = new Hono<AppEnv>();
  routes.use("*", requireScope("school:read"));

  routes.get("/summary", async c => {
    const principal = c.get("principal");
    const organizationId = principal.organizationId;
    const requestedDate = c.req.query("date");
    // "Today" follows the school's own timezone, not the database's UTC clock.
    const clock = await runtime.db.query(`SELECT tz,(now() AT TIME ZONE tz)::date::text AS today
      FROM (SELECT COALESCE((SELECT timezone FROM school_profiles WHERE organization_id=$1),'Africa/Kampala') AS tz) z`, [organizationId]);
    const { tz, today } = clock.rows[0] as { tz: string; today: string };
    const day = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? "") ? requestedDate! : today;

    const [profile, period, population, attendance, collections, admissions, discipline] = await Promise.all([
      runtime.db.query(`SELECT o.name AS school_name,sp.motto,sp.default_currency,sp.timezone,sp.branding
        FROM organizations o LEFT JOIN school_profiles sp ON sp.organization_id=o.id WHERE o.id=$1`, [organizationId]),
      runtime.db.query(`SELECT ay.name AS academic_year,t.name AS term,t.starts_on::text AS term_starts_on,t.ends_on::text AS term_ends_on
        FROM school_academic_years ay LEFT JOIN school_terms t ON t.organization_id=ay.organization_id AND t.is_current=true
        WHERE ay.organization_id=$1 AND ay.is_current=true LIMIT 1`, [organizationId]),
      runtime.db.query(`SELECT
        COUNT(*) FILTER (WHERE s.status='active' AND s.deleted_at IS NULL)::int AS active_students,
        (SELECT COUNT(*)::int FROM school_staff_profiles sp WHERE sp.organization_id=$1 AND sp.employment_status='active' AND sp.deleted_at IS NULL) AS active_staff
        FROM school_students s WHERE s.organization_id=$1`, [organizationId]),
      runtime.db.query(`WITH chosen_day AS (SELECT $2::date AS day),
        student AS (SELECT COUNT(DISTINCT s.id)::int AS sessions,COALESCE(SUM(s.expected_count),0)::int AS expected,
          COALESCE(SUM(s.marked_count),0)::int AS marked,
          COUNT(*) FILTER (WHERE r.status='present')::int AS present,
          COUNT(*) FILTER (WHERE r.status='absent')::int AS absent,
          COUNT(*) FILTER (WHERE r.status='late')::int AS late,
          COUNT(*) FILTER (WHERE r.status IN ('excused','sick','permission'))::int AS excused
          FROM school_student_attendance_sessions s LEFT JOIN school_student_attendance_records r ON r.session_id=s.id
          WHERE s.organization_id=$1 AND s.attendance_date=(SELECT day FROM chosen_day) AND s.status<>'cancelled'),
        staff AS (SELECT COUNT(*)::int AS marked,
          COUNT(*) FILTER (WHERE status='present')::int AS present,
          COUNT(*) FILTER (WHERE status='absent')::int AS absent,
          COUNT(*) FILTER (WHERE status='late')::int AS late,
          COUNT(*) FILTER (WHERE status IN ('on_leave','sick','official_duty','remote','half_day'))::int AS other
          FROM school_staff_attendance_records WHERE organization_id=$1 AND attendance_date=(SELECT day FROM chosen_day))
        SELECT (SELECT day::text FROM chosen_day) AS date,row_to_json(student) AS students,row_to_json(staff) AS staff FROM student,staff`, [organizationId, day]),
      runtime.db.query(`SELECT COUNT(*)::int AS receipt_count,COALESCE(SUM(amount_minor),0)::float8 AS amount_minor
        FROM school_fee_receipts WHERE organization_id=$1 AND payment_date=$2::date`, [organizationId, day]),
      runtime.db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('submitted','screening','waitlisted','approved'))::int AS open,
        COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $3)::date=$2::date)::int AS received_today
        FROM school_admission_applications WHERE organization_id=$1`, [organizationId, day, tz]),
      runtime.db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('open','investigating','actioned'))::int AS open,
        COUNT(*) FILTER (WHERE severity='critical' AND status NOT IN ('resolved','closed'))::int AS critical,
        COUNT(*) FILTER (WHERE (incident_at AT TIME ZONE $3)::date=$2::date)::int AS reported_today,
        COUNT(*) FILTER (WHERE record_type='merit' AND (incident_at AT TIME ZONE $3)::date=$2::date)::int AS merits_today
        FROM school_discipline_incidents WHERE organization_id=$1`, [organizationId, day, tz]),
    ]);

    const attendanceRow = attendance.rows[0] as Record<string, unknown> | undefined;
    c.header("Cache-Control", "no-store");
    return c.json({ data: {
      date: attendanceRow?.date,
      generatedAt: new Date().toISOString(),
      profile: camel((profile.rows[0] ?? {}) as Record<string, unknown>),
      period: camel((period.rows[0] ?? {}) as Record<string, unknown>),
      population: camel((population.rows[0] ?? {}) as Record<string, unknown>),
      attendance: { students: attendanceRow?.students ?? {}, staff: attendanceRow?.staff ?? {} },
      collections: camel((collections.rows[0] ?? {}) as Record<string, unknown>),
      admissions: camel((admissions.rows[0] ?? {}) as Record<string, unknown>),
      discipline: camel((discipline.rows[0] ?? {}) as Record<string, unknown>),
    } });
  });

  return routes;
}
