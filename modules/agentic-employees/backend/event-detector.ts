import { createId } from "../../../src/lib/ids";
import type { Env } from "../../../src/types";

export async function detectDerivedEmployeeEvents(env: Env) {
  const overdue = await env.FINANCE_DB.prepare(`SELECT p.id,p.organization_id AS organizationId,p.lesson_date AS lessonDate,p.status
    FROM acad_lesson_plans p
    WHERE p.lesson_date<date('now') AND p.status NOT IN ('delivered','archived')
      AND NOT EXISTS (
        SELECT 1 FROM ae_event_inbox e
        WHERE e.organization_id=p.organization_id AND e.event_type='academics.lesson_plan_overdue' AND e.source_record_id=p.id
      )
    ORDER BY p.lesson_date ASC LIMIT 50`).all<any>();

  for (const row of overdue.results) {
    await env.FINANCE_DB.prepare(`INSERT INTO ae_event_inbox
      (id,organization_id,event_type,source_module,source_record_id,subject_type,subject_id,payload_json,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(createId("aev"),row.organizationId,"academics.lesson_plan_overdue","academics",row.id,"lesson_plan",row.id,
        JSON.stringify({lessonDate:row.lessonDate,status:row.status})).run();
  }
}
