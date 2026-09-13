import type { Env } from "../../../src/types";
import { runSingleProactive } from "./proactive-runner";

export async function runProactiveWorkflow(env: Env, organizationId: string, actorUserId: string, workflowKey: string, triggerType = "manual", scheduleId?: string | null) {
  if (workflowKey !== "headteacher_daily_brief") {
    return runSingleProactive(env, organizationId, actorUserId, workflowKey, triggerType, scheduleId);
  }

  const specialistKeys = ["dos_daily_review", "bursar_daily_review", "hr_daily_review", "secretary_daily_review"];
  const reports: Record<string, string> = {};
  for (const key of specialistKeys) {
    const recent = await env.FINANCE_DB.prepare("SELECT summary FROM ae_proactive_runs WHERE organization_id=? AND workflow_key=? AND status='completed' AND started_at>=datetime('now','-8 hours') ORDER BY started_at DESC LIMIT 1")
      .bind(organizationId, key).first<{ summary: string }>();
    if (recent?.summary) {
      reports[key] = recent.summary;
      continue;
    }
    try {
      const child = await runSingleProactive(env, organizationId, actorUserId, key, "delegated");
      reports[key] = child.summary || "No specialist summary produced.";
    } catch {
      reports[key] = "Specialist review unavailable; verify this area manually.";
    }
  }

  return runSingleProactive(env, organizationId, actorUserId, "headteacher_daily_brief", triggerType, scheduleId, null, { specialistReports: reports });
}
