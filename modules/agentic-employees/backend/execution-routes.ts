import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { executeApprovedAction } from "./executor";

export const agenticExecutionRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const actionOperator:MiddlewareHandler<{Bindings:Env;Variables:AppVariables}>=async(c,next)=>{const p=c.get("principal");if(p.role==="owner"||p.role==="admin"||p.scopes.some(scope=>scope.endsWith(":write"))){await next();return;}throw new AppError(403,"FORBIDDEN","A Ledgerly write permission is required to execute AI actions");};

agenticExecutionRoutes.post("/approvals/:id/execute",actionOperator,async c=>{
  const principal=c.get("principal"),approvalId=c.req.param("id");
  const approval=await c.env.FINANCE_DB.prepare("SELECT required_scope AS requiredScope FROM ae_approvals WHERE id=? AND organization_id=? AND status='approved'").bind(approvalId,principal.organizationId).first<{requiredScope:string}>();
  if(!approval)throw new AppError(409,"INVALID_STATE","Only an approved action can execute");
  if(principal.role!=="owner"&&principal.role!=="admin"&&!principal.scopes.includes(approval.requiredScope))throw new AppError(403,"FORBIDDEN",`Execution requires ${approval.requiredScope}`);
  const data=await executeApprovedAction(c.env,principal,approvalId);
  await c.env.FINANCE_DB.prepare(`UPDATE ae_actions SET result_entity_type=?,result_entity_id=?,executed_by=?,executed_at=COALESCE(executed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND approval_id=? AND status='executed'`).bind((data as any).entityType||null,(data as any).entityId||null,principal.userId,principal.organizationId,approvalId).run();
  return c.json({data});
});
