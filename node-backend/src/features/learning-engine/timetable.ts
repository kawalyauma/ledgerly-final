import { z } from "zod";
import type { PoolClient } from "pg";
import type { Runtime } from "../../runtime.js";
import { AppError } from "../../http/errors.js";
import { createId } from "../core-identity/security.js";

/* ───────────── Settings and bell ───────────── */

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
export const settingsSchema = z.object({
  periodMinutes: z.number().int().min(10).max(180).optional(),
  dayStartsAt: hhmm.optional(),
  periodsPerDay: z.number().int().min(1).max(16).optional(),
  schoolDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  breaks: z.array(z.object({ afterPeriod: z.number().int().min(1).max(15), minutes: z.number().int().min(5).max(180), label: z.string().trim().min(1).max(60) })).max(8).optional(),
  maxSubjectPeriodsPerDay: z.number().int().min(1).max(8).optional(),
  morningSubjects: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
});
export type TimetableSettings = Required<z.infer<typeof settingsSchema>>;

export async function getTimetableSettings(runtime: Runtime, organizationId: string): Promise<TimetableSettings> {
  const r = await runtime.db.query<TimetableSettings>(
    `SELECT period_minutes AS "periodMinutes",to_char(day_starts_at,'HH24:MI') AS "dayStartsAt",periods_per_day AS "periodsPerDay",school_days AS "schoolDays",
            breaks,max_subject_periods_per_day AS "maxSubjectPeriodsPerDay",morning_subjects AS "morningSubjects"
       FROM lrn_timetable_settings WHERE organization_id=$1`, [organizationId]);
  return r.rows[0] ?? {
    periodMinutes: 40, dayStartsAt: "08:00", periodsPerDay: 8, schoolDays: [1, 2, 3, 4, 5],
    breaks: [{ afterPeriod: 2, minutes: 20, label: "Break" }, { afterPeriod: 5, minutes: 60, label: "Lunch" }],
    maxSubjectPeriodsPerDay: 2, morningSubjects: ["mathematics", "english", "science"],
  };
}

export async function saveTimetableSettings(runtime: Runtime, organizationId: string, userId: string, patch: z.infer<typeof settingsSchema>) {
  const s = { ...await getTimetableSettings(runtime, organizationId), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as TimetableSettings;
  if (s.breaks.some(b => b.afterPeriod >= s.periodsPerDay)) throw new AppError(422, "VALIDATION_ERROR", "A break must come after a period that exists and before the last one");
  await runtime.db.query(
    `INSERT INTO lrn_timetable_settings(organization_id,period_minutes,day_starts_at,periods_per_day,school_days,breaks,max_subject_periods_per_day,morning_subjects,updated_by,updated_at)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id) DO UPDATE SET period_minutes=EXCLUDED.period_minutes,day_starts_at=EXCLUDED.day_starts_at,periods_per_day=EXCLUDED.periods_per_day,
       school_days=EXCLUDED.school_days,breaks=EXCLUDED.breaks,max_subject_periods_per_day=EXCLUDED.max_subject_periods_per_day,
       morning_subjects=EXCLUDED.morning_subjects,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`,
    [organizationId, s.periodMinutes, s.dayStartsAt, s.periodsPerDay, [...new Set(s.schoolDays)].sort(), JSON.stringify(s.breaks), s.maxSubjectPeriodsPerDay,
      s.morningSubjects.map(m => m.toLowerCase()), userId]);
  return s;
}

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h! * 60 + m!; };
const toTime = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Rebuilds the bell schedule from the settings (period length, start time, breaks). */
export async function generateBell(runtime: Runtime, organizationId: string) {
  const s = await getTimetableSettings(runtime, organizationId);
  const rows: Array<{ label: string; kind: z.infer<typeof bellSchema>[number]["kind"]; start: string; end: string }> = [];
  let t = toMin(s.dayStartsAt);
  for (let p = 1; p <= s.periodsPerDay; p += 1) {
    rows.push({ label: `Period ${p}`, kind: "lesson", start: toTime(t), end: toTime(t + s.periodMinutes) });
    t += s.periodMinutes;
    for (const b of s.breaks.filter(x => x.afterPeriod === p)) {
      rows.push({ label: b.label, kind: /lunch/i.test(b.label) ? "lunch" : "break", start: toTime(t), end: toTime(t + b.minutes) });
      t += b.minutes;
    }
  }
  if (t > 24 * 60) throw new AppError(422, "DAY_TOO_LONG", "These settings run past midnight");
  await replaceBell(runtime, organizationId, rows.map(r => ({ label: r.label, kind: r.kind, startsAt: r.start, endsAt: r.end })));
  return listBell(runtime, organizationId);
}

export const bellSchema = z.array(z.object({
  label: z.string().trim().min(1).max(60),
  kind: z.enum(["lesson", "break", "lunch", "assembly", "games", "prep", "other"]),
  startsAt: hhmm, endsAt: hhmm,
})).min(1).max(30);

export async function replaceBell(runtime: Runtime, organizationId: string, rows: z.infer<typeof bellSchema>) {
  const sorted = [...rows].sort((a, b) => toMin(a.startsAt) - toMin(b.startsAt));
  for (const [i, r] of sorted.entries()) {
    if (toMin(r.endsAt) <= toMin(r.startsAt)) throw new AppError(422, "VALIDATION_ERROR", `${r.label} must end after it starts`);
    if (i && toMin(r.startsAt) < toMin(sorted[i - 1]!.endsAt)) throw new AppError(422, "VALIDATION_ERROR", `${r.label} overlaps ${sorted[i - 1]!.label}`);
  }
  const used = await runtime.db.query(
    `SELECT 1 FROM lrn_timetable_slots s JOIN lrn_timetables t ON t.id=s.timetable_id WHERE s.organization_id=$1 AND t.status='published' LIMIT 1`, [organizationId]);
  if (used.rowCount) throw new AppError(409, "BELL_IN_USE", "Archive the published timetable before changing the bell schedule");
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM lrn_bell_periods WHERE organization_id=$1", [organizationId]);
    for (const [i, r] of sorted.entries())
      await client.query(`INSERT INTO lrn_bell_periods(id,organization_id,seq,label,kind,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [createId("lbell"), organizationId, i + 1, r.label, r.kind, r.startsAt, r.endsAt]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

export async function listBell(runtime: Runtime, organizationId: string) {
  return (await runtime.db.query<{ id: string; seq: number; label: string; kind: string; startsAt: string; endsAt: string }>(
    `SELECT id,seq,label,kind,to_char(starts_at,'HH24:MI') AS "startsAt",to_char(ends_at,'HH24:MI') AS "endsAt" FROM lrn_bell_periods WHERE organization_id=$1 ORDER BY seq`,
    [organizationId])).rows;
}

/* ───────────── Subject loads ───────────── */

export const loadsSchema = z.object({
  termId: z.string().min(1).max(160),
  loads: z.array(z.object({
    classId: z.string().min(1).max(160), subjectId: z.string().min(1).max(160), teacherStaffId: z.string().max(160).nullish(),
    periodsPerWeek: z.number().int().min(0).max(30), doublePeriods: z.number().int().min(0).max(10).default(0), room: z.string().max(60).nullish(),
  })).max(2000),
});

export async function saveLoads(runtime: Runtime, organizationId: string, input: z.infer<typeof loadsSchema>) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    for (const l of input.loads) {
      if (l.doublePeriods * 2 > l.periodsPerWeek) throw new AppError(422, "VALIDATION_ERROR", "Double periods cannot exceed half of the weekly periods");
      if (l.periodsPerWeek === 0) {
        await client.query(`DELETE FROM lrn_subject_loads WHERE organization_id=$1 AND term_id=$2 AND class_id=$3 AND subject_id=$4`, [organizationId, input.termId, l.classId, l.subjectId]);
        continue;
      }
      await client.query(
        `INSERT INTO lrn_subject_loads(id,organization_id,term_id,class_id,subject_id,teacher_staff_id,periods_per_week,double_periods,room)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
          WHERE EXISTS (SELECT 1 FROM school_terms WHERE id=$3 AND organization_id=$2) AND EXISTS (SELECT 1 FROM school_classes WHERE id=$4 AND organization_id=$2)
            AND EXISTS (SELECT 1 FROM school_subjects WHERE id=$5 AND organization_id=$2)
            AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM school_staff_profiles WHERE id=$6 AND organization_id=$2))
         ON CONFLICT(organization_id,term_id,class_id,subject_id) DO UPDATE SET teacher_staff_id=EXCLUDED.teacher_staff_id,periods_per_week=EXCLUDED.periods_per_week,
           double_periods=EXCLUDED.double_periods,room=EXCLUDED.room`,
        [createId("lload"), organizationId, input.termId, l.classId, l.subjectId, l.teacherStaffId ?? null, l.periodsPerWeek, l.doublePeriods, l.room ?? null]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  return listLoads(runtime, organizationId, input.termId);
}

export async function listLoads(runtime: Runtime, organizationId: string, termId: string, classId?: string) {
  return (await runtime.db.query(
    `SELECT l.id,l.class_id AS "classId",c.name AS "className",l.subject_id AS "subjectId",s.name AS "subjectName",l.teacher_staff_id AS "teacherStaffId",
            NULLIF(concat_ws(' ',sp.first_name,sp.last_name),'') AS teacher,l.periods_per_week AS "periodsPerWeek",l.double_periods AS "doublePeriods",l.room
       FROM lrn_subject_loads l JOIN school_classes c ON c.id=l.class_id JOIN school_subjects s ON s.id=l.subject_id LEFT JOIN school_staff_profiles sp ON sp.id=l.teacher_staff_id
      WHERE l.organization_id=$1 AND l.term_id=$2 AND ($3::text IS NULL OR l.class_id=$3) ORDER BY c.name,s.name`, [organizationId, termId, classId ?? null])).rows;
}

/** Pre-fills loads from the school's teaching assignments (teacher and periods per week), then from the term's schemes. */
export async function loadsFromSchemes(runtime: Runtime, organizationId: string, termId: string) {
  const fromAssignments = await runtime.db.query(
    `INSERT INTO lrn_subject_loads(id,organization_id,term_id,class_id,subject_id,teacher_staff_id,periods_per_week)
     SELECT DISTINCT ON (a.class_id,a.subject_id) 'lload_'||replace(gen_random_uuid()::text,'-',''),a.organization_id,$2,a.class_id,a.subject_id,a.staff_id,
            LEAST(30,GREATEST(1,COALESCE(a.periods_per_week,(SELECT max(sc.periods_per_week) FROM lrn_schemes sc WHERE sc.organization_id=a.organization_id
              AND sc.term_id=$2 AND sc.class_id=a.class_id AND sc.subject_id=a.subject_id),5)))
       FROM school_staff_teaching_assignments a
      WHERE a.organization_id=$1 AND a.active AND a.class_id IS NOT NULL AND a.subject_id IS NOT NULL
        AND (a.term_id=$2 OR (a.term_id IS NULL AND a.academic_year_id=(SELECT academic_year_id FROM school_terms WHERE id=$2)))
      ORDER BY a.class_id,a.subject_id,(a.term_id=$2) DESC NULLS LAST,a.updated_at DESC
     ON CONFLICT DO NOTHING RETURNING id`, [organizationId, termId]);
  const fromSchemes = await runtime.db.query(
    `INSERT INTO lrn_subject_loads(id,organization_id,term_id,class_id,subject_id,periods_per_week)
     SELECT 'lload_'||replace(gen_random_uuid()::text,'-',''),organization_id,term_id,class_id,subject_id,max(periods_per_week)
       FROM lrn_schemes WHERE organization_id=$1 AND term_id=$2 AND status<>'archived' GROUP BY organization_id,term_id,class_id,subject_id
     ON CONFLICT DO NOTHING RETURNING id`, [organizationId, termId]);
  return { added: (fromAssignments.rowCount ?? 0) + (fromSchemes.rowCount ?? 0), loads: await listLoads(runtime, organizationId, termId) };
}

/* ───────────── Generator ───────────── */

type Load = { id: string; classId: string; subjectId: string; subjectName: string; teacherStaffId: string | null; periodsPerWeek: number; doublePeriods: number; room: string | null };
type Placement = { classId: string; weekday: number; periodIndex: number; load: Load };
type Unplaced = { classId: string; subjectId: string; subject: string; periods: number; reason: string };

/** Seeded random so a given attempt is reproducible. */
function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

/**
 * Places every subject load on the weekly grid. Hard rules: one lesson per class per period, no teacher in two
 * classes at once, fixed activities kept, at most N periods of a subject per day, doubles in adjacent periods
 * with no break between. Soft rules: spread a subject across the week, morning subjects early, balanced days.
 * Runs many randomised attempts and keeps the best.
 */
export function solveTimetable(input: {
  days: number[]; lessonPeriods: Array<{ id: string; seq: number }>; adjacentPairs: Set<number>;
  loads: Load[]; blocked: Set<string>; maxPerDay: number; morning: Set<string>; attempts?: number;
}) {
  const P = input.lessonPeriods.length;
  let best: { placements: Placement[]; unplaced: Unplaced[]; score: number } | null = null;
  for (let attempt = 0; attempt < (input.attempts ?? 60); attempt += 1) {
    const rand = rng(attempt * 7919 + 17);
    const classBusy = new Set<string>(input.blocked);
    const teacherBusy = new Set<string>();
    const perDay = new Map<string, number>();
    const placements: Placement[] = [];
    const unplaced: Unplaced[] = [];
    let score = 0;
    type Task = { load: Load; size: 1 | 2 };
    const tasks: Task[] = [];
    for (const l of input.loads) {
      for (let d = 0; d < l.doublePeriods; d += 1) tasks.push({ load: l, size: 2 });
      for (let s = 0; s < l.periodsPerWeek - 2 * l.doublePeriods; s += 1) tasks.push({ load: l, size: 1 });
    }
    const teacherLoad = new Map<string, number>();
    for (const l of input.loads) if (l.teacherStaffId) teacherLoad.set(l.teacherStaffId, (teacherLoad.get(l.teacherStaffId) ?? 0) + l.periodsPerWeek);
    tasks.sort((a, b) => b.size - a.size || (teacherLoad.get(b.load.teacherStaffId ?? "") ?? 0) - (teacherLoad.get(a.load.teacherStaffId ?? "") ?? 0) || rand() - 0.5);
    for (const task of tasks) {
      const l = task.load;
      let pick: { day: number; p: number; cost: number } | null = null;
      for (const day of input.days) {
        const already = perDay.get(`${l.classId}|${l.subjectId}|${day}`) ?? 0;
        if (already + task.size > Math.max(input.maxPerDay, task.size)) continue;
        for (let p = 0; p + task.size <= P; p += 1) {
          if (task.size === 2 && !input.adjacentPairs.has(p)) continue;
          let free = true;
          for (let k = 0; k < task.size; k += 1) {
            if (classBusy.has(`${l.classId}|${day}|${p + k}`) || (l.teacherStaffId && teacherBusy.has(`${l.teacherStaffId}|${day}|${p + k}`))) { free = false; break; }
          }
          if (!free) continue;
          const sameNeighbour = [p - 1, p + task.size].some(q => placements.some(x => x.classId === l.classId && x.weekday === day && x.periodIndex === q && x.load.subjectId === l.subjectId));
          const cost = already * 12 + (sameNeighbour ? 6 : 0)
            + (input.morning.has(l.subjectName.toLowerCase()) ? p * 1.5 : (P - p) * 0.3)
            + rand() * 2;
          if (!pick || cost < pick.cost) pick = { day, p, cost };
        }
      }
      if (!pick) { unplaced.push({ classId: l.classId, subjectId: l.subjectId, subject: l.subjectName, periods: task.size, reason: "No free period for this class and teacher within the daily limit" }); score += 1000; continue; }
      for (let k = 0; k < task.size; k += 1) {
        classBusy.add(`${l.classId}|${pick.day}|${pick.p + k}`);
        if (l.teacherStaffId) teacherBusy.add(`${l.teacherStaffId}|${pick.day}|${pick.p + k}`);
        placements.push({ classId: l.classId, weekday: pick.day, periodIndex: pick.p + k, load: l });
      }
      perDay.set(`${l.classId}|${l.subjectId}|${pick.day}`, (perDay.get(`${l.classId}|${l.subjectId}|${pick.day}`) ?? 0) + task.size);
      score += pick.cost;
    }
    if (!best || score < best.score) best = { placements, unplaced, score };
    if (best.unplaced.length === 0 && attempt >= 20) break;
  }
  return best!;
}

export const generateSchema = z.object({ termId: z.string().min(1).max(160), name: z.string().trim().max(120).optional(), classIds: z.array(z.string().max(160)).max(200).optional() });

export async function generateTimetable(runtime: Runtime, organizationId: string, userId: string, input: z.infer<typeof generateSchema>) {
  const settings = await getTimetableSettings(runtime, organizationId);
  let bell = await listBell(runtime, organizationId);
  if (!bell.length) bell = await generateBell(runtime, organizationId);
  const lessonPeriods = bell.filter(b => b.kind === "lesson");
  if (!lessonPeriods.length) throw new AppError(422, "NO_LESSON_PERIODS", "The bell schedule has no lesson periods");
  // Two lesson periods are adjacent when nothing (break, lunch...) sits between them.
  const adjacentPairs = new Set<number>();
  lessonPeriods.forEach((p, i) => { const next = lessonPeriods[i + 1]; if (next && next.seq === p.seq + 1) adjacentPairs.add(i); });
  const loads = (await runtime.db.query<Load>(
    `SELECT l.id,l.class_id AS "classId",l.subject_id AS "subjectId",s.name AS "subjectName",l.teacher_staff_id AS "teacherStaffId",
            l.periods_per_week AS "periodsPerWeek",l.double_periods AS "doublePeriods",l.room
       FROM lrn_subject_loads l JOIN school_subjects s ON s.id=l.subject_id
      WHERE l.organization_id=$1 AND l.term_id=$2 AND (cardinality($3::text[])=0 OR l.class_id=ANY($3::text[]))`,
    [organizationId, input.termId, input.classIds ?? []])).rows;
  if (!loads.length) throw new AppError(422, "NO_LOADS", "Set the periods per week for each class and subject first");
  const fixed = (await runtime.db.query<{ classId: string | null; weekday: number; bellPeriodId: string; label: string }>(
    `SELECT class_id AS "classId",weekday,bell_period_id AS "bellPeriodId",label FROM lrn_timetable_fixed WHERE organization_id=$1`, [organizationId])).rows;
  const classes = [...new Set(loads.map(l => l.classId))];
  const indexOf = new Map(lessonPeriods.map((p, i) => [p.id, i]));
  const blocked = new Set<string>();
  for (const f of fixed) for (const c of f.classId ? [f.classId] : classes) {
    const i = indexOf.get(f.bellPeriodId);
    if (i !== undefined) blocked.add(`${c}|${f.weekday}|${i}`);
  }
  // Capacity check per class before solving.
  const capacity = settings.schoolDays.length * lessonPeriods.length;
  const overloaded = classes.map(c => ({ c, need: loads.filter(l => l.classId === c).reduce((n, l) => n + l.periodsPerWeek, 0), fixed: [...blocked].filter(k => k.startsWith(`${c}|`)).length }))
    .filter(x => x.need > capacity - x.fixed);
  const result = solveTimetable({
    days: settings.schoolDays, lessonPeriods, adjacentPairs, loads, blocked, maxPerDay: settings.maxSubjectPeriodsPerDay,
    morning: new Set(settings.morningSubjects.map(m => m.toLowerCase())),
  });
  const id = createId("ltt");
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO lrn_timetables(id,organization_id,term_id,name,status,report,created_by) VALUES($1,$2,$3,$4,'draft',$5::jsonb,$6)`,
      [id, organizationId, input.termId, input.name || `Timetable ${new Date().toISOString().slice(0, 10)}`,
        JSON.stringify({ placed: result.placements.length, unplaced: result.unplaced, overloadedClasses: overloaded.map(o => ({ classId: o.c, periodsNeeded: o.need, periodsAvailable: capacity - o.fixed })) }), userId]);
    for (const p of result.placements)
      await client.query(`INSERT INTO lrn_timetable_slots(id,organization_id,timetable_id,class_id,weekday,bell_period_id,subject_id,teacher_staff_id,room) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [createId("lslot"), organizationId, id, p.classId, p.weekday, lessonPeriods[p.periodIndex]!.id, p.load.subjectId, p.load.teacherStaffId, p.load.room]);
    for (const f of fixed) for (const c of f.classId ? [f.classId] : classes)
      await client.query(`INSERT INTO lrn_timetable_slots(id,organization_id,timetable_id,class_id,weekday,bell_period_id,label,locked) VALUES($1,$2,$3,$4,$5,$6,$7,true) ON CONFLICT DO NOTHING`,
        [createId("lslot"), organizationId, id, c, f.weekday, f.bellPeriodId, f.label]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  return getTimetable(runtime, organizationId, id);
}

export async function getTimetable(runtime: Runtime, organizationId: string, id: string, classId?: string) {
  const tt = await runtime.db.query(
    `SELECT t.id,t.name,t.status,t.term_id AS "termId",tr.name AS "termName",t.report,t.created_at AS "createdAt",t.published_at AS "publishedAt"
       FROM lrn_timetables t JOIN school_terms tr ON tr.id=t.term_id WHERE t.id=$1 AND t.organization_id=$2`, [id, organizationId]);
  if (!tt.rows[0]) throw new AppError(404, "NOT_FOUND", "Timetable not found");
  const [bell, slots] = await Promise.all([
    listBell(runtime, organizationId),
    runtime.db.query(
      `SELECT s.id,s.class_id AS "classId",c.name AS "className",s.weekday,s.bell_period_id AS "bellPeriodId",s.subject_id AS "subjectId",sub.name AS subject,
              s.teacher_staff_id AS "teacherStaffId",NULLIF(concat_ws(' ',sp.first_name,sp.last_name),'') AS teacher,s.room,s.label,s.locked
         FROM lrn_timetable_slots s JOIN school_classes c ON c.id=s.class_id LEFT JOIN school_subjects sub ON sub.id=s.subject_id
         LEFT JOIN school_staff_profiles sp ON sp.id=s.teacher_staff_id
        WHERE s.timetable_id=$1 AND ($2::text IS NULL OR s.class_id=$2) ORDER BY c.name,s.weekday`, [id, classId ?? null]),
  ]);
  return { ...tt.rows[0], bell, slots: slots.rows };
}

export const slotEditSchema = z.object({
  classId: z.string().min(1).max(160), weekday: z.number().int().min(1).max(7), bellPeriodId: z.string().min(1).max(160),
  subjectId: z.string().max(160).nullable(), teacherStaffId: z.string().max(160).nullish(), room: z.string().max(60).nullish(), label: z.string().max(60).nullish(),
});

/** Sets (or clears) one cell of a draft timetable, refusing teacher clashes. */
export async function editSlot(runtime: Runtime, organizationId: string, timetableId: string, v: z.infer<typeof slotEditSchema>) {
  const tt = await runtime.db.query<{ status: string }>(`SELECT status FROM lrn_timetables WHERE id=$1 AND organization_id=$2`, [timetableId, organizationId]);
  if (!tt.rows[0]) throw new AppError(404, "NOT_FOUND", "Timetable not found");
  if (tt.rows[0].status !== "draft") throw new AppError(409, "TIMETABLE_LOCKED", "Only draft timetables can be edited; copy it to a new draft");
  if (v.teacherStaffId) {
    const clash = await runtime.db.query<{ className: string }>(
      `SELECT c.name AS "className" FROM lrn_timetable_slots s JOIN school_classes c ON c.id=s.class_id
        WHERE s.timetable_id=$1 AND s.teacher_staff_id=$2 AND s.weekday=$3 AND s.bell_period_id=$4 AND s.class_id<>$5`,
      [timetableId, v.teacherStaffId, v.weekday, v.bellPeriodId, v.classId]);
    if (clash.rows[0]) throw new AppError(409, "TEACHER_CLASH", `That teacher is already teaching ${clash.rows[0].className} in this period`);
  }
  if (!v.subjectId && !v.label) {
    await runtime.db.query(`DELETE FROM lrn_timetable_slots WHERE timetable_id=$1 AND class_id=$2 AND weekday=$3 AND bell_period_id=$4`, [timetableId, v.classId, v.weekday, v.bellPeriodId]);
    return { cleared: true };
  }
  await runtime.db.query(
    `INSERT INTO lrn_timetable_slots(id,organization_id,timetable_id,class_id,weekday,bell_period_id,subject_id,teacher_staff_id,room,label)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE EXISTS (SELECT 1 FROM lrn_bell_periods WHERE id=$6 AND organization_id=$2 AND kind='lesson')
     ON CONFLICT(timetable_id,class_id,weekday,bell_period_id) DO UPDATE SET subject_id=EXCLUDED.subject_id,teacher_staff_id=EXCLUDED.teacher_staff_id,room=EXCLUDED.room,label=EXCLUDED.label`,
    [createId("lslot"), organizationId, timetableId, v.classId, v.weekday, v.bellPeriodId, v.subjectId, v.teacherStaffId ?? null, v.room ?? null, v.label ?? null]);
  return { saved: true };
}

export async function publishTimetable(runtime: Runtime, organizationId: string, userId: string, id: string) {
  const tt = await runtime.db.query<{ termId: string }>(`SELECT term_id AS "termId" FROM lrn_timetables WHERE id=$1 AND organization_id=$2`, [id, organizationId]);
  if (!tt.rows[0]) throw new AppError(404, "NOT_FOUND", "Timetable not found");
  await runtime.db.query(`UPDATE lrn_timetables SET status='archived' WHERE organization_id=$1 AND term_id=$2 AND status='published' AND id<>$3`, [organizationId, tt.rows[0].termId, id]);
  await runtime.db.query(`UPDATE lrn_timetables SET status='published',published_at=CURRENT_TIMESTAMP WHERE id=$1`, [id]);
  const plan = await buildPeriodPlan(runtime, organizationId, { timetableId: id });
  return { id, status: "published", plan, publishedBy: userId };
}

/* ───────────── Period plan ───────────── */

type Part = { schemeId: string; lessonId: string; part: number; parts: number; topic: string; subtopic: string | null };

async function lessonParts(db: PoolClient, organizationId: string, termId: string, classId: string, subjectId: string): Promise<Part[]> {
  const scheme = await db.query<{ id: string }>(
    `SELECT id FROM lrn_schemes WHERE organization_id=$1 AND term_id=$2 AND class_id=$3 AND subject_id=$4 AND status NOT IN ('archived','failed')
      ORDER BY (status='published') DESC,updated_at DESC LIMIT 1`, [organizationId, termId, classId, subjectId]);
  if (!scheme.rows[0]) return [];
  const lessons = await db.query<{ id: string; periods: number; title: string; subtopic: string | null; unit: string }>(
    `SELECT l.id,l.periods,l.title,l.subtopic,u.title AS unit FROM lrn_lessons l JOIN lrn_units u ON u.id=l.unit_id WHERE l.scheme_id=$1 ORDER BY l.seq`, [scheme.rows[0].id]);
  return lessons.rows.flatMap(l => Array.from({ length: Math.max(1, l.periods) }, (_, i) => ({
    schemeId: scheme.rows[0]!.id, lessonId: l.id, part: i + 1, parts: Math.max(1, l.periods), topic: l.unit, subtopic: l.subtopic ? `${l.title}: ${l.subtopic}` : l.title,
  })));
}

/**
 * Lays the scheme lessons onto the timetable, day by day across the term: each timetabled period of a class and
 * subject takes the next lesson part. Taught periods are kept; everything from `from` onwards is re-planned, so
 * missed lessons move forward automatically.
 */
export async function buildPeriodPlan(runtime: Runtime, organizationId: string, input: { timetableId: string; from?: string; classId?: string }) {
  const tt = await runtime.db.query<{ termId: string; startsOn: string; endsOn: string }>(
    `SELECT t.term_id AS "termId",tr.starts_on::text AS "startsOn",tr.ends_on::text AS "endsOn" FROM lrn_timetables t JOIN school_terms tr ON tr.id=t.term_id
      WHERE t.id=$1 AND t.organization_id=$2`, [input.timetableId, organizationId]);
  const t = tt.rows[0];
  if (!t) throw new AppError(404, "NOT_FOUND", "Timetable not found");
  if (!t.startsOn || !t.endsOn) throw new AppError(422, "TERM_DATES_MISSING", "Set the term's start and end dates first");
  const from = input.from && input.from > t.startsOn ? input.from : t.startsOn;
  const settings = await getTimetableSettings(runtime, organizationId);
  const client = await runtime.db.connect();
  let planned = 0, free = 0;
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM lrn_period_plan WHERE timetable_id=$1 AND plan_date >= $2::date AND status IN ('planned','free') AND ($3::text IS NULL OR class_id=$3)`,
      [input.timetableId, from, input.classId ?? null]);
    const slots = (await client.query<{ id: string; classId: string; subjectId: string; teacherStaffId: string | null; weekday: number; startsAt: string; endsAt: string }>(
      `SELECT s.id,s.class_id AS "classId",s.subject_id AS "subjectId",s.teacher_staff_id AS "teacherStaffId",s.weekday,b.starts_at::text AS "startsAt",b.ends_at::text AS "endsAt"
         FROM lrn_timetable_slots s JOIN lrn_bell_periods b ON b.id=s.bell_period_id
        WHERE s.timetable_id=$1 AND s.subject_id IS NOT NULL AND ($2::text IS NULL OR s.class_id=$2) ORDER BY s.weekday,b.starts_at`,
      [input.timetableId, input.classId ?? null])).rows;
    const daysOff = (await client.query<{ day: string; classId: string | null }>(
      `SELECT day::text,class_id AS "classId" FROM lrn_days_off WHERE organization_id=$1 AND day BETWEEN $2::date AND $3::date`, [organizationId, from, t.endsOn])).rows;
    const off = (day: string, classId: string) => daysOff.some(d => d.day === day && (!d.classId || d.classId === classId));
    // Per class+subject: remaining lesson parts, after those already taught or planned before `from`.
    const queues = new Map<string, Part[]>();
    for (const key of new Set(slots.map(s => `${s.classId}|${s.subjectId}`))) {
      const [classId, subjectId] = key.split("|") as [string, string];
      const parts = await lessonParts(client, organizationId, t.termId, classId, subjectId);
      const consumed = new Set((await client.query<{ k: string }>(
        `SELECT lesson_id||'#'||lesson_part AS k FROM lrn_period_plan WHERE timetable_id=$1 AND class_id=$2 AND subject_id=$3 AND lesson_id IS NOT NULL
            AND (status='taught' OR (status='planned' AND plan_date < $4::date))`, [input.timetableId, classId, subjectId, from])).rows.map(r => r.k));
      queues.set(key, parts.filter(p => !consumed.has(`${p.lessonId}#${p.part}`)));
    }
    // Periods already marked taught or missed on or after `from` stay as they are and do not take a new lesson part.
    const kept = new Set((await client.query<{ k: string }>(
      `SELECT slot_id||'|'||plan_date::text AS k FROM lrn_period_plan WHERE timetable_id=$1 AND plan_date >= $2::date AND ($3::text IS NULL OR class_id=$3)`,
      [input.timetableId, from, input.classId ?? null])).rows.map(r => r.k));
    const rows: unknown[][] = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${t.endsOn}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      if (!settings.schoolDays.includes(weekday)) continue;
      for (const s of slots.filter(x => x.weekday === weekday)) {
        if (off(iso, s.classId) || kept.has(`${s.id}|${iso}`)) continue;
        const next = queues.get(`${s.classId}|${s.subjectId}`)?.shift();
        rows.push([createId("lplan"), organizationId, input.timetableId, s.id, s.classId, s.subjectId, s.teacherStaffId, iso, s.startsAt, s.endsAt,
          next?.schemeId ?? null, next?.lessonId ?? null, next?.part ?? null, next?.parts ?? null, next?.topic ?? null, next?.subtopic ?? null, next ? "planned" : "free"]);
        if (next) planned += 1; else free += 1;
      }
    }
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const cols = 17;
      await client.query(
        `INSERT INTO lrn_period_plan(id,organization_id,timetable_id,slot_id,class_id,subject_id,teacher_staff_id,plan_date,starts_at,ends_at,scheme_id,lesson_id,lesson_part,lesson_parts,topic,subtopic,status)
         VALUES ${chunk.map((_, r) => `(${Array.from({ length: cols }, (_, c) => `$${r * cols + c + 1}`).join(",")})`).join(",")}
         ON CONFLICT(slot_id,plan_date) DO NOTHING`, chunk.flat());
    }
    const leftover = [...queues.entries()].filter(([, q]) => q.length).map(([k, q]) => ({ classSubject: k, periodsNotFitting: q.length }));
    await client.query("COMMIT");
    return { from, to: t.endsOn, plannedPeriods: planned, freePeriods: free, notFittingInTerm: leftover };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
}

export async function listPlan(runtime: Runtime, organizationId: string, f: { classId?: string; teacherStaffId?: string; from: string; to: string }) {
  return (await runtime.db.query(
    `SELECT p.id,p.plan_date::text AS date,to_char(p.starts_at,'HH24:MI') AS "startsAt",to_char(p.ends_at,'HH24:MI') AS "endsAt",p.class_id AS "classId",c.name AS "className",
            p.subject_id AS "subjectId",s.name AS subject,NULLIF(concat_ws(' ',sp.first_name,sp.last_name),'') AS teacher,p.topic,p.subtopic,
            p.lesson_id AS "lessonId",p.lesson_part AS part,p.lesson_parts AS parts,p.status
       FROM lrn_period_plan p JOIN lrn_timetables t ON t.id=p.timetable_id AND t.status='published'
       JOIN school_classes c ON c.id=p.class_id JOIN school_subjects s ON s.id=p.subject_id LEFT JOIN school_staff_profiles sp ON sp.id=p.teacher_staff_id
      WHERE p.organization_id=$1 AND p.plan_date BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR p.class_id=$4) AND ($5::text IS NULL OR p.teacher_staff_id=$5)
      ORDER BY p.plan_date,p.starts_at,c.name LIMIT 5000`, [organizationId, f.from, f.to, f.classId ?? null, f.teacherStaffId ?? null])).rows;
}

/** Marks a planned period taught or missed. Missed periods push that class's remaining lessons forward. */
export async function setPlanStatus(runtime: Runtime, organizationId: string, id: string, status: "taught" | "missed" | "planned") {
  const row = await runtime.db.query<{ timetableId: string; classId: string; date: string }>(
    `UPDATE lrn_period_plan SET status=$3,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status<>'free'
      RETURNING timetable_id AS "timetableId",class_id AS "classId",plan_date::text AS date`, [id, organizationId, status]);
  if (!row.rows[0]) throw new AppError(404, "NOT_FOUND", "Planned period not found");
  if (status === "missed") {
    const next = new Date(`${row.rows[0].date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    return { id, status, replanned: await buildPeriodPlan(runtime, organizationId, { timetableId: row.rows[0].timetableId, classId: row.rows[0].classId, from: next.toISOString().slice(0, 10) }) };
  }
  return { id, status };
}

export const dayOffSchema = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), classId: z.string().max(160).nullish(), label: z.string().trim().min(1).max(120) });
