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
  const due = await env.FINANCE_DB.prepare(`SELECT s.id,s.organization_id AS organizationId,s.workflow_key AS workflowKey,s.actor_user_id AS actorUserId,
    s.cadence,s.run_hour AS runHour,s.run_minute AS runMinute,s.weekday
    FROM ae_proactive_schedules s
    JOIN memberships m ON m.organization_id=s.organization_id AND m.user_id=s.actor_user_id
    JOIN users u ON u.id=m.user_id
    WHERE s.enabled=1 AND s.next_run_at IS NOT NULL AND s.next_run_at<=CURRENT_TIMESTAMP
      AND u.status='active' AND m.role IN ('owner','admin')
    ORDER BY s.next_run_at LIMIT 20`).all<DueSchedule>();

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
