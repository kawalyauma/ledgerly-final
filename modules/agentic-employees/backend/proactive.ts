import { createId } from "../../../src/lib/ids";

export type ProactiveCadence = "daily" | "weekly";
export type ProactiveWorkflow = {
  key: string;
  agentKey: "secretary" | "dos" | "bursar" | "headteacher" | "hr" | "librarian";
  prompt: string;
  cadence: ProactiveCadence;
  runHour: number;
  runMinute: number;
  weekday: number | null;
};

export const PROACTIVE_WORKFLOWS: ProactiveWorkflow[] = [
  { key: "dos_daily_review", agentKey: "dos", cadence: "daily", runHour: 6, runMinute: 30, weekday: null, prompt: "Review academics overview, lesson-plan queue and scheme coverage. Produce a concise DOS supervision brief with verified issues and today's priorities. Do not prepare communications." },
  { key: "bursar_daily_review", agentKey: "bursar", cadence: "daily", runHour: 7, runMinute: 0, weekday: null, prompt: "Review fee collection health and arrears. Produce a concise bursar morning brief with verified figures and follow-up priorities. Do not post transactions or prepare communications." },
  { key: "hr_daily_review", agentKey: "hr", cadence: "daily", runHour: 7, runMinute: 15, weekday: null, prompt: "Review workforce health and the HR leave queue. Produce a concise HR operations brief with verified issues. Do not approve leave or prepare communications." },
  { key: "secretary_daily_review", agentKey: "secretary", cadence: "daily", runHour: 7, runMinute: 30, weekday: null, prompt: "Review the school snapshot and communications health. Produce a concise front-office morning brief. Do not prepare outbound communication." },
  { key: "librarian_weekly_review", agentKey: "librarian", cadence: "weekly", runHour: 7, runMinute: 20, weekday: 1, prompt: "Review writing-book stock and learner distribution context. Produce a concise weekly books operations brief. Do not alter stock records." },
  { key: "headteacher_daily_brief", agentKey: "headteacher", cadence: "daily", runHour: 7, runMinute: 45, weekday: null, prompt: "Produce the Head Teacher daily management brief. Synthesize specialist reports, rank issues by urgency, and end with today's action list." },
];

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second) };
}

function localToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let pass = 0; pass < 2; pass++) {
    const actual = zonedParts(new Date(guess), timeZone);
    guess += Date.UTC(year, month - 1, day, hour, minute, 0) - Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
  }
  return new Date(guess);
}

export function nextOccurrence(timeZone: string, hour: number, minute: number, cadence: ProactiveCadence, weekday: number | null, from = new Date()) {
  const local = zonedParts(from, timeZone);
  for (let offset = 0; offset < 9; offset++) {
    const base = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
    if (cadence === "weekly" && weekday != null && base.getUTCDay() !== weekday) continue;
    const candidate = localToUtc(timeZone, base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute);
    if (candidate.getTime() > from.getTime() + 30_000) return candidate.toISOString();
  }
  return new Date(from.getTime() + 86_400_000).toISOString();
}

export async function organizationTimezone(db: D1Database, organizationId: string) {
  const row = await db.prepare("SELECT timezone FROM organizations WHERE id=?").bind(organizationId).first<{ timezone?: string }>();
  return row?.timezone || "Africa/Kampala";
}

export async function ensureDefaultProactiveSchedules(db: D1Database, organizationId: string, actorUserId: string) {
  const timeZone = await organizationTimezone(db, organizationId);
  for (const item of PROACTIVE_WORKFLOWS) {
    const nextRunAt = nextOccurrence(timeZone, item.runHour, item.runMinute, item.cadence, item.weekday);
    await db.prepare(`INSERT INTO ae_proactive_schedules (id,organization_id,workflow_key,agent_key,actor_user_id,enabled,cadence,run_hour,run_minute,weekday,next_run_at,updated_by)
      VALUES (?,?,?,?,?,1,?,?,?,?,?,?) ON CONFLICT(organization_id,workflow_key) DO NOTHING`)
      .bind(createId("aps"), organizationId, item.key, item.agentKey, actorUserId, item.cadence, item.runHour, item.runMinute, item.weekday, nextRunAt, actorUserId).run();
  }
}

export function workflowDefinition(key: string) {
  return PROACTIVE_WORKFLOWS.find(item => item.key === key) || null;
}
