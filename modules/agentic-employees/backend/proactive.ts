import type { Env } from "../../../src/types";
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

export async function ensureDefaultProactiveSchedules(db: D1Database, organizationId: string, actorId?: string) {
  for (const item of PROACTIVE_WORKFLOWS) {
    await db.prepare(`INSERT INTO ae_proactive_schedules (id,organization_id,workflow_key,agent_key,enabled,cadence,run_hour,run_minute,weekday,updated_by) VALUES (?,?,?,?,1,?,?,?,?,?) ON CONFLICT(organization_id,workflow_key) DO NOTHING`)
      .bind(createId("aps"), organizationId, item.key, item.agentKey, item.cadence, item.runHour, item.runMinute, item.weekday, actorId || null).run();
  }
}

export function workflowDefinition(key: string) { return PROACTIVE_WORKFLOWS.find(item => item.key === key) || null; }

export async function runDueProactiveSchedules(_env: Env) { return; }
