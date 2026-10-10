import type { Runtime } from "../../runtime.js";
import type { AuthPrincipal } from "../../http/types.js";
import { listPlan } from "./timetable.js";
import { ulibtech } from "../school-management/ulibtech.js";

/* The signed-in staff member's view for the Ledgerly Academics app: who they are, what they teach, today's periods, counts. */

const has = (p: AuthPrincipal, ...scopes: string[]) => p.scopes.includes("*") || scopes.some(s => p.scopes.includes(s));

export async function me(runtime: Runtime, p: AuthPrincipal) {
  const o = p.organizationId;
  const clock = await runtime.db.query<{ today: string; now: string; weekStart: string; weekEnd: string }>(
    `SELECT d::text AS today,to_char(now() AT TIME ZONE tz,'HH24:MI') AS now,
            (d - (extract(isodow FROM d)::int - 1))::text AS "weekStart",(d + (7 - extract(isodow FROM d)::int))::text AS "weekEnd"
       FROM (SELECT tz,(now() AT TIME ZONE tz)::date AS d FROM (SELECT COALESCE((SELECT timezone FROM school_profiles WHERE organization_id=$1),'Africa/Kampala') AS tz) z) x`, [o]);
  const { today, now, weekStart, weekEnd } = clock.rows[0]!;
  const [user, school, term, staff] = await Promise.all([
    runtime.db.query(`SELECT display_name AS name,email FROM users WHERE id=$1`, [p.userId]),
    runtime.db.query(`SELECT name FROM organizations WHERE id=$1`, [o]),
    runtime.db.query(`SELECT id,name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",CASE WHEN $2::date BETWEEN starts_on AND ends_on THEN (($2::date-starts_on)/7)+1 END::int AS week,($2::date BETWEEN starts_on AND ends_on) AS "inTerm"
                        FROM school_terms WHERE organization_id=$1 ORDER BY ($2::date BETWEEN starts_on AND ends_on) DESC,is_current DESC,starts_on DESC LIMIT 1`, [o, today]),
    runtime.db.query(`SELECT id,concat_ws(' ',first_name,last_name) AS name,is_teacher AS "isTeacher" FROM school_staff_profiles
                       WHERE organization_id=$1 AND user_id=$2 AND deleted_at IS NULL ORDER BY active DESC LIMIT 1`, [o, p.userId]),
  ]);
  const staffId: string | null = staff.rows[0]?.id ?? null;
  const t = term.rows[0] ?? null;
  const assigned = staffId ? await runtime.db.query(
    `SELECT DISTINCT a.class_id AS "classId",c.name AS "className",a.subject_id AS "subjectId",s.name AS "subjectName"
       FROM school_staff_teaching_assignments a JOIN school_classes c ON c.id=a.class_id LEFT JOIN school_subjects s ON s.id=a.subject_id
      WHERE a.organization_id=$1 AND a.staff_id=$2 AND a.active AND ($3::text IS NULL OR a.term_id IS NULL OR a.term_id=$3)
      ORDER BY c.name,s.name`, [o, staffId, t?.id ?? null]) : { rows: [] };
  const mine = assigned.rows.length > 0;
  const [classes, subjects] = mine
    ? [dedupe(assigned.rows.map(r => ({ id: r.classId, name: r.className }))), dedupe(assigned.rows.filter(r => r.subjectId).map(r => ({ id: r.subjectId, name: r.subjectName })))]
    : await Promise.all([
      runtime.db.query(`SELECT id,name FROM school_classes WHERE organization_id=$1 AND active ORDER BY name`, [o]).then(r => r.rows),
      runtime.db.query(`SELECT id,name FROM school_subjects WHERE organization_id=$1 AND active ORDER BY name`, [o]).then(r => r.rows),
    ]);
  const teacherStaffId = mine ? staffId! : undefined;
  const [todayPlan, week, stats] = await Promise.all([
    listPlan(runtime, o, { from: today, to: today, teacherStaffId }),
    runtime.db.query<{ planned: number; taught: number }>(
      `SELECT count(*) FILTER (WHERE p.status<>'free')::int AS planned,count(*) FILTER (WHERE p.status='taught')::int AS taught
         FROM lrn_period_plan p JOIN lrn_timetables tt ON tt.id=p.timetable_id AND tt.status='published'
        WHERE p.organization_id=$1 AND p.plan_date BETWEEN $2::date AND LEAST($3::date,$4::date) AND ($5::text IS NULL OR p.teacher_staff_id=$5)`,
      [o, weekStart, weekEnd, today, teacherStaffId ?? null]),
    runtime.db.query(
      `SELECT (SELECT count(*)::int FROM lrn_teaching_events WHERE organization_id=$1 AND (created_by=$2 OR teacher_staff_id=$3) AND ($4::text IS NULL OR term_id=$4)) AS "lessonsTaught",
              (SELECT count(*)::int FROM lrn_capture_pages pg JOIN lrn_capture_batches b ON b.id=pg.batch_id WHERE b.organization_id=$1 AND b.created_by=$2) AS "pagesScanned",
              (SELECT count(*)::int FROM lrn_capture_pages pg JOIN lrn_capture_batches b ON b.id=pg.batch_id WHERE b.organization_id=$1 AND pg.status='needs_review') AS "pagesToReview",
              (SELECT count(*)::int FROM lrn_schemes WHERE organization_id=$1 AND status='published') AS "schemesPublished",
              (SELECT count(*)::int FROM lrn_schemes WHERE organization_id=$1 AND status='review') AS "schemesToReview"`,
      [o, p.userId, staffId, t?.id ?? null]),
  ]);
  const nowPeriod = todayPlan.find((x: { startsAt: string; endsAt: string; status: string }) => x.status !== "free" && x.startsAt <= now && now < x.endsAt) ?? null;
  const nextPeriod = todayPlan.find((x: { startsAt: string; status: string }) => x.status !== "free" && x.startsAt > now) ?? null;
  return {
    user: { id: p.userId, name: user.rows[0]?.name || staff.rows[0]?.name || user.rows[0]?.email || "Teacher", email: user.rows[0]?.email ?? null, role: p.role },
    staff: staff.rows[0] ?? null,
    school: school.rows[0]?.name ?? null,
    term: t,
    today, now,
    can: {
      write: has(p, "learning:write", "school:write"),
      capture: has(p, "learning:capture", "learning:write", "school:write"),
      manage: p.role === "owner" || p.role === "admin" || has(p, "learning:admin", "learning:dos"),
      admin: p.role === "owner" || has(p, "learning:admin"),
    },
    classes, subjects, allClasses: !mine,
    todayPlan, nowPeriod, nextPeriod,
    week: { from: weekStart, to: weekEnd, planned: week.rows[0]?.planned ?? 0, taught: week.rows[0]?.taught ?? 0 },
    stats: stats.rows[0],
  };
}

function dedupe(items: Array<{ id: string; name: string }>) {
  const seen = new Set<string>();
  return items.filter(i => !seen.has(i.id) && seen.add(i.id));
}

/** One search box: Ledgerly records plus the trusted Notesug catalogue, including drafts. */
export async function search(runtime: Runtime, organizationId: string, q: string) {
  const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
  const [lessons, learners, questions, resources] = await Promise.all([
    runtime.db.query(
      `SELECT l.id,l.title,l.subtopic,l.week,l.status,c.name AS "className",s.name AS subject,sc.id AS "schemeId"
         FROM lrn_lessons l JOIN lrn_schemes sc ON sc.id=l.scheme_id JOIN school_classes c ON c.id=sc.class_id JOIN school_subjects s ON s.id=sc.subject_id
        WHERE sc.organization_id=$1 AND sc.status<>'archived' AND (l.title ILIKE $2 OR l.subtopic ILIKE $2 OR l.notes_markdown ILIKE $2)
        ORDER BY (l.title ILIKE $2) DESC,l.seq LIMIT 8`, [organizationId, like]),
    runtime.db.query(
      `SELECT st.id,concat_ws(' ',st.first_name,st.middle_name,st.last_name) AS name,st.admission_number AS "admissionNumber",c.name AS "className"
         FROM school_students st LEFT JOIN school_classes c ON c.id=st.current_class_id
        WHERE st.organization_id=$1 AND st.deleted_at IS NULL AND (concat_ws(' ',st.first_name,st.middle_name,st.last_name) ILIKE $2 OR st.admission_number ILIKE $2)
        ORDER BY st.first_name LIMIT 8`, [organizationId, like]),
    runtime.db.query(
      `SELECT q.id,q.stem,q.topic,c.name AS "className",s.name AS subject
         FROM lrn_questions q LEFT JOIN school_classes c ON c.id=q.class_id LEFT JOIN school_subjects s ON s.id=q.subject_id
        WHERE q.organization_id=$1 AND q.status<>'retired' AND q.stem ILIKE $2 ORDER BY q.times_given DESC,q.created_at DESC LIMIT 8`, [organizationId, like]),
    ulibtech(runtime).catalog({ q, limit: 16 }).catch(() => []),
  ]);
  return { lessons: lessons.rows, learners: learners.rows, questions: questions.rows,
    resources: resources.map(resource => ({ ...resource, pageUrl: ulibtech(runtime).links(resource.slug).pageUrl })) };
}
