import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { executeApprovedAction } from "./executor";

export const agenticExecutionRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

agenticExecutionRoutes.post("/approvals/:id/execute", requireScope("school:write"), async c => {
  const principal = c.get("principal");
  const approvalId=c.req.param("id");
  const data = await executeApprovedAction(c.env, principal, approvalId);
  await c.env.FINANCE_DB.prepare(`UPDATE ae_actions SET result_entity_type=?,result_entity_id=?,executed_by=?,executed_at=COALESCE(executed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
    WHERE organization_id=? AND approval_id=? AND status='executed'`)
    .bind((data as any).entityType||null,(data as any).entityId||null,principal.userId,principal.organizationId,approvalId).run();
  return c.json({ data });
});
