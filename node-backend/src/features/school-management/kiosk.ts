import { Hono } from "hono";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { AppError } from "../../http/errors.js";

function camel(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
  return out;
}

const camelRows = (rows: unknown[]) => rows.map(row => camel(row as Record<string, unknown>));

const staffName = (alias: string) => `NULLIF(concat_ws(' ',COALESCE(NULLIF(${alias}.preferred_name,''),${alias}.first_name),${alias}.last_name),'')`;

/**
 * Aggregate-only data for unattended displays. No learner identities, balances or payments leave this endpoint;
 * the only money shown is the published fee structure per class.
 */
export function createSchoolKioskRoutes(runtime: Runtime) {
  const routes = new Hono<AppEnv>();
  // school:kiosk is a display-only scope: API keys holding it can read this aggregate feed and nothing else.
  routes.use("*", async (c, next) => {
    const { role, scopes } = c.get("principal");
    if (role !== "owner" && role !== "admin" && !scopes.includes("school:read") && !scopes.includes("school:kiosk"))
      throw new AppError(403, "FORBIDDEN", "Missing required scope: school:kiosk");
    await next();
  });

  routes.get("/summary", async c => {
    const principal = c.get("principal");
    const organizationId = principal.organizationId;
    const requestedDate = c.req.query("date");
    // "Today" and the current period follow the school's own timezone, not the database's UTC clock.
    const clock = await runtime.db.query(`SELECT tz,(now() AT TIME ZONE tz)::date::text AS today,(now() AT TIME ZONE tz)::time::text AS now_time
      FROM (SELECT COALESCE((SELECT timezone FROM school_profiles WHERE organization_id=$1),'Africa/Kampala') AS tz) z`, [organizationId]);
    const { tz, today, now_time: nowTime } = clock.rows[0] as { tz: string; today: string; now_time: string };
    const day = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? "") ? requestedDate! : today;

    const [profile, period, population, attendance, admissions, discipline, classes, services, notices, feeStructures, lessons, coverage, plans, duty] = await Promise.all([
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
      runtime.db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('submitted','screening','waitlisted','approved'))::int AS open,
        COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $3)::date=$2::date)::int AS received_today
        FROM school_admission_applications WHERE organization_id=$1`, [organizationId, day, tz]),
      runtime.db.query(`SELECT COUNT(*) FILTER (WHERE status IN ('open','investigating','actioned'))::int AS open,
        COUNT(*) FILTER (WHERE severity='critical' AND status NOT IN ('resolved','closed'))::int AS critical,
        COUNT(*) FILTER (WHERE (incident_at AT TIME ZONE $3)::date=$2::date)::int AS reported_today,
        COUNT(*) FILTER (WHERE record_type='merit' AND (incident_at AT TIME ZONE $3)::date=$2::date)::int AS merits_today
        FROM school_discipline_incidents WHERE organization_id=$1`, [organizationId, day, tz]),
      runtime.db.query(`SELECT c.name,c.capacity,
          COUNT(DISTINCT st.id)::int AS students,
          COALESCE(MAX(a.marked),0)::int AS marked,COALESCE(MAX(a.present),0)::int AS present
        FROM school_classes c
        LEFT JOIN school_students st ON st.current_class_id=c.id AND st.status='active' AND st.deleted_at IS NULL
        LEFT JOIN (SELECT s.class_id,COUNT(r.id) AS marked,COUNT(r.id) FILTER (WHERE r.status IN ('present','late')) AS present
          FROM school_student_attendance_sessions s JOIN school_student_attendance_records r ON r.session_id=s.id
          WHERE s.organization_id=$1 AND s.attendance_date=$2::date AND s.status<>'cancelled' GROUP BY s.class_id) a ON a.class_id=c.id
        WHERE c.organization_id=$1 AND c.active=true
        GROUP BY c.id,c.name,c.capacity ORDER BY c.name`, [organizationId, day]),
      runtime.db.query(`SELECT
          (SELECT COUNT(*)::int FROM school_clinic_visits WHERE organization_id=$1 AND (visited_at AT TIME ZONE $3)::date=$2::date) AS clinic_today,
          (SELECT COUNT(*)::int FROM school_library_loans WHERE organization_id=$1 AND returned_on IS NULL) AS library_out,
          (SELECT COUNT(*)::int FROM school_library_loans WHERE organization_id=$1 AND returned_on IS NULL AND due_on<$2::date) AS library_overdue,
          (SELECT COUNT(*)::int FROM school_homework_assignments WHERE organization_id=$1 AND due_on::date=$2::date) AS homework_due`, [organizationId, day, tz]),
      runtime.db.query(`SELECT title,published_at FROM school_parent_portal_announcements
        WHERE organization_id=$1 AND active=true AND published_at<=now() AND (expires_at IS NULL OR expires_at>now())
        ORDER BY published_at DESC LIMIT 5`, [organizationId]),
      // Published fee structure for the current term — what each class pays, not who has paid.
      runtime.db.query(`SELECT COALESCE(c.name,cl.name,fs.name) AS class_name,fs.currency,
          SUM(l.amount_minor)::float8 AS total_minor,
          json_agg(json_build_object('category',COALESCE(fc.name,l.description,'Fees'),'amountMinor',l.amount_minor::float8,'mandatory',l.mandatory) ORDER BY l.amount_minor DESC) AS lines
        FROM school_fee_structures fs
        JOIN school_fee_structure_lines l ON l.structure_id=fs.id
        LEFT JOIN school_fee_categories fc ON fc.id=l.fee_category_id
        LEFT JOIN school_classes c ON c.id=fs.class_id
        LEFT JOIN school_class_levels cl ON cl.id=fs.class_level_id
        WHERE fs.organization_id=$1 AND fs.status='active'
          AND fs.term_id=(SELECT id FROM school_terms WHERE organization_id=$1 AND is_current=true LIMIT 1)
        GROUP BY fs.id,c.name,cl.name,fs.name,fs.currency ORDER BY SUM(l.amount_minor),1`, [organizationId]),
      // Today's lessons: the published (else approved) timetable for the current term, enriched with the topic/subtopic
      // from the lesson plan or scheme of work; lesson plans with times fill in when no timetable is published yet.
      runtime.db.query(`WITH term AS (SELECT id FROM school_terms WHERE organization_id=$1 AND is_current=true LIMIT 1),
        tt AS (SELECT id FROM school_academic_timetables WHERE organization_id=$1 AND term_id=(SELECT id FROM term) AND status IN ('published','approved')
          ORDER BY (status='published') DESC,published_at DESC NULLS LAST,approved_at DESC NULLS LAST LIMIT 1),
        slots AS (
          SELECT 'timetable' AS source,e.class_id,e.subject_id,e.teacher_staff_id,e.starts_at,e.ends_at,ro.name AS room,e.scheme_id,e.default_topic_id
          FROM school_academic_timetable_entries e LEFT JOIN school_academic_rooms ro ON ro.id=e.room_id
          WHERE e.organization_id=$1 AND e.timetable_id=(SELECT id FROM tt) AND e.weekday=EXTRACT(ISODOW FROM $2::date)::int
          UNION ALL
          SELECT 'lesson_plan',lp.class_id,lp.subject_id,lp.teacher_staff_id,lp.starts_at,lp.ends_at,NULL,NULL,NULL
          FROM school_lesson_plans lp
          WHERE lp.organization_id=$1 AND lp.lesson_date=$2::date AND lp.status<>'cancelled'
            AND NOT EXISTS (SELECT 1 FROM tt)
          UNION ALL
          SELECT 'scheme',w.class_id,w.subject_id,w.teacher_staff_id,NULL,NULL,NULL,w.id,t.id
          FROM school_scheme_lessons l JOIN school_scheme_topics t ON t.id=l.topic_id JOIN school_schemes_of_work w ON w.id=t.scheme_id
          WHERE l.organization_id=$1 AND l.planned_date=$2::date AND NOT EXISTS (SELECT 1 FROM tt)
            AND NOT EXISTS (SELECT 1 FROM school_lesson_plans lp WHERE lp.organization_id=$1 AND lp.lesson_date=$2::date AND lp.status<>'cancelled'
              AND lp.class_id IS NOT DISTINCT FROM w.class_id AND lp.subject_id IS NOT DISTINCT FROM w.subject_id)
        )
        SELECT s.source,s.starts_at::text AS starts_at,s.ends_at::text AS ends_at,s.room,
          c.name AS class_name,su.name AS subject,COALESCE(NULLIF(su.short_name,''),su.name) AS subject_short,
          ${staffName("sp")} AS teacher,
          COALESCE(plan.topic,sl.topic_title,dt.title) AS topic,
          COALESCE(plan.subtopic,sl.subtopic) AS subtopic,
          COALESCE(sl.title,plan.competency) AS lesson_title,
          plan.status AS plan_status
        FROM slots s
        LEFT JOIN school_classes c ON c.id=s.class_id
        LEFT JOIN school_subjects su ON su.id=s.subject_id
        LEFT JOIN school_staff_profiles sp ON sp.id=s.teacher_staff_id
        LEFT JOIN school_scheme_topics dt ON dt.id=s.default_topic_id
        LEFT JOIN LATERAL (SELECT lp.topic,lp.subtopic,lp.competency,lp.status FROM school_lesson_plans lp
          WHERE lp.organization_id=$1 AND lp.lesson_date=$2::date AND lp.class_id IS NOT DISTINCT FROM s.class_id AND lp.subject_id IS NOT DISTINCT FROM s.subject_id
            AND lp.status<>'cancelled'
          ORDER BY (lp.starts_at=s.starts_at) DESC NULLS LAST,lp.updated_at DESC LIMIT 1) plan ON true
        LEFT JOIN LATERAL (SELECT l.title,l.subtopic,t.title AS topic_title FROM school_scheme_lessons l
          JOIN school_scheme_topics t ON t.id=l.topic_id JOIN school_schemes_of_work w ON w.id=t.scheme_id
          WHERE l.organization_id=$1 AND l.planned_date=$2::date
            AND (w.id=s.scheme_id OR (w.class_id IS NOT DISTINCT FROM s.class_id AND w.subject_id IS NOT DISTINCT FROM s.subject_id))
          ORDER BY (w.id=s.scheme_id) DESC,l.sequence_no LIMIT 1) sl ON true
        ORDER BY s.starts_at NULLS LAST,c.name,su.name`, [organizationId, day]),
      // Syllabus coverage per scheme of work for the current term: lessons delivered vs planned, and how many were due by today.
      runtime.db.query(`WITH term AS (SELECT id FROM school_terms WHERE organization_id=$1 AND is_current=true LIMIT 1)
        SELECT c.name AS class_name,COALESCE(NULLIF(su.short_name,''),su.name) AS subject,${staffName("sp")} AS teacher,
          COUNT(l.id)::int AS lessons,
          COUNT(l.id) FILTER (WHERE l.status IN ('delivered','assessed'))::int AS delivered,
          COUNT(l.id) FILTER (WHERE l.planned_date<=$2::date)::int AS due,
          COUNT(l.id) FILTER (WHERE l.status IN ('plan_drafted','delivered','assessed') OR l.lesson_plan_id IS NOT NULL)::int AS planned,
          COALESCE((SELECT SUM(i.planned_periods) FROM school_scheme_items i WHERE i.scheme_id=w.id),0)::int AS item_periods,
          COALESCE((SELECT SUM(i.actual_periods) FROM school_scheme_items i WHERE i.scheme_id=w.id),0)::int AS item_periods_done,
          (SELECT t2.title FROM school_scheme_topics t2 WHERE t2.scheme_id=w.id AND $2::date BETWEEN t2.planned_start_on AND t2.planned_end_on ORDER BY t2.planned_start_on LIMIT 1) AS current_topic
        FROM school_schemes_of_work w
        LEFT JOIN school_scheme_topics t ON t.scheme_id=w.id
        LEFT JOIN school_scheme_lessons l ON l.topic_id=t.id
        LEFT JOIN school_classes c ON c.id=w.class_id
        LEFT JOIN school_subjects su ON su.id=w.subject_id
        LEFT JOIN school_staff_profiles sp ON sp.id=w.teacher_staff_id
        WHERE w.organization_id=$1 AND (w.term_id=(SELECT id FROM term) OR w.term_id IS NULL)
        GROUP BY w.id,c.name,su.short_name,su.name,sp.preferred_name,sp.first_name,sp.last_name
        ORDER BY c.name,su.name LIMIT 12`, [organizationId, day]),
      runtime.db.query(`WITH term AS (SELECT id,starts_on,ends_on FROM school_terms WHERE organization_id=$1 AND is_current=true LIMIT 1)
        SELECT
          COUNT(*) FILTER (WHERE status='draft')::int AS draft,
          COUNT(*) FILTER (WHERE status='submitted')::int AS submitted,
          COUNT(*) FILTER (WHERE status='approved')::int AS approved,
          COUNT(*) FILTER (WHERE status='changes_requested')::int AS changes_requested,
          COUNT(*) FILTER (WHERE status='delivered')::int AS delivered,
          COUNT(*) FILTER (WHERE lesson_date=$2::date)::int AS today,
          COUNT(*) FILTER (WHERE lesson_date BETWEEN $2::date AND $2::date+6)::int AS this_week
        FROM school_lesson_plans
        WHERE organization_id=$1 AND status<>'cancelled'
          AND (term_id=(SELECT id FROM term) OR lesson_date BETWEEN (SELECT starts_on FROM term) AND (SELECT ends_on FROM term))`, [organizationId, day]),
      runtime.db.query(`SELECT r.duty_role,r.starts_on::text AS starts_on,r.ends_on::text AS ends_on,r.notes,${staffName("s")} AS staff_name
        FROM school_duty_rosters r JOIN school_staff_profiles s ON s.id=r.staff_id
        WHERE r.organization_id=$1 AND $2::date BETWEEN r.starts_on AND r.ends_on
        ORDER BY (r.duty_role ILIKE '%teacher on duty%') DESC,r.duty_role,s.first_name`, [organizationId, day]),
    ]);

    const attendanceRow = attendance.rows[0] as Record<string, unknown> | undefined;
    c.header("Cache-Control", "no-store");
    return c.json({ data: {
      date: attendanceRow?.date,
      now: nowTime.slice(0, 8),
      generatedAt: new Date().toISOString(),
      profile: camel((profile.rows[0] ?? {}) as Record<string, unknown>),
      period: camel((period.rows[0] ?? {}) as Record<string, unknown>),
      population: camel((population.rows[0] ?? {}) as Record<string, unknown>),
      attendance: { students: attendanceRow?.students ?? {}, staff: attendanceRow?.staff ?? {} },
      admissions: camel((admissions.rows[0] ?? {}) as Record<string, unknown>),
      discipline: camel((discipline.rows[0] ?? {}) as Record<string, unknown>),
      classes: camelRows(classes.rows),
      services: camel((services.rows[0] ?? {}) as Record<string, unknown>),
      notices: camelRows(notices.rows),
      feeStructures: camelRows(feeStructures.rows),
      lessons: camelRows(lessons.rows),
      coverage: camelRows(coverage.rows),
      lessonPlans: camel((plans.rows[0] ?? {}) as Record<string, unknown>),
      duty: camelRows(duty.rows),
    } });
  });

  return routes;
}
