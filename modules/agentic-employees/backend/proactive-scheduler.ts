import type { Env } from "../../../src/types";
import { nextOccurrence, organizationTimezone, type ProactiveCadence } from "./proactive";
import { runProactiveWorkflow } from "./proactive-orchestrator";

type DueSchedule = {
  id: string;
  organizationId: string;
  workflowKey: string;
  actorUserId: string;
  cadence: ProactiveCadence;
  runHour: number;
  runMinute: number;
  weekday: number | null;
};

export async function runDueProactiveSchedules(env: Env) {
  const due = await env.FINANCE_DB.prepare(`SELECT id,organization_id AS organizationId,workflow_key AS workflowKey,actor_user_id AS actorUserId,
    cadence,run_hour AS runHour,run_minute AS runMinute,weekday
    FROM ae_proactive_schedules
    WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=CURRENT_TIMESTAMP
    ORDER BY next_run_at LIMIT 20`).all<DueSchedule>();

  for (const schedule of due.results) {
    try {
      await runProactiveWorkflow(env, schedule.organizationId, schedule.actorUserId, schedule.workflowKey, "scheduled", schedule.id);
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        module: "agentic-employees",
        workflowKey: schedule.workflowKey,
        organizationId: schedule.organizationId,
        message: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      const timeZone = await organizationTimezone(env.FINANCE_DB, schedule.organizationId);
      const nextRunAt = nextOccurrence(timeZone, Number(schedule.runHour), Number(schedule.runMinute), schedule.cadence, schedule.weekday, new Date(Date.now() + 60_000));
      await env.FINANCE_DB.prepare("UPDATE ae_proactive_schedules SET last_run_at=CURRENT_TIMESTAMP,next_run_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
        .bind(nextRunAt, schedule.id, schedule.organizationId).run();
    }
  }
}
