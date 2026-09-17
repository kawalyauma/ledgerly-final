import { AppError } from "./shared.js";
import { createId } from "./shared.js";
import type { AuthPrincipal, Env } from "./shared.js";
import { nextTaskNumber, requireOrgUser } from "./stubs.js";
import { hasScope } from "./policy.js";

export type WorkTaskPayload = {
  title?: string;
  description?: string;
  priority?: "low"|"medium"|"high"|"urgent";
  assigneeUserId?: string | null;
  dueAt?: string | null;
};

export async function executeWorkTaskAction(env: Env, principal: AuthPrincipal, payload: WorkTaskPayload) {
  if (!hasScope(principal,"work:write")) throw new AppError(403,"FORBIDDEN","Creating an AI follow-up task requires work:write");
  const enabled = await env.FINANCE_DB.prepare("SELECT enabled FROM organization_modules WHERE organization_id=? AND module_key='tasks-work'")
    .bind(principal.organizationId).first<{enabled:number}>();
  if (!enabled || !Boolean(enabled.enabled)) throw new AppError(409,"TASKS_WORK_DISABLED","Tasks & Work must be enabled before this action can execute");
  const title = String(payload.title || "").trim().slice(0,240);
  if (!title) throw new AppError(422,"INVALID_ACTION_PAYLOAD","Task title is required");
  const description = String(payload.description || "").trim().slice(0,10000) || null;
  const priority = ["low","medium","high","urgent"].includes(String(payload.priority)) ? String(payload.priority) : "medium";
  const assigneeUserId = payload.assigneeUserId ? String(payload.assigneeUserId) : null;
  if (assigneeUserId) await requireOrgUser(env.FINANCE_DB,principal.organizationId,assigneeUserId,"Task assignee");
  const taskId=createId("wtsk"),taskNumber=await nextTaskNumber(env.FINANCE_DB,principal.organizationId);
  const statements=[env.FINANCE_DB.prepare(`INSERT INTO work_tasks
    (id,organization_id,task_number,title,description,status,priority,due_at,created_by,updated_by)
    VALUES (?,?,?,?,?,'todo',?,?,?,?)`)
    .bind(taskId,principal.organizationId,taskNumber,title,description,priority,payload.dueAt||null,principal.userId,principal.userId)];
  if(assigneeUserId) statements.push(env.FINANCE_DB.prepare("INSERT INTO work_task_assignees(task_id,user_id,assigned_by) VALUES (?,?,?)")
    .bind(taskId,assigneeUserId,principal.userId));
  statements.push(env.FINANCE_DB.prepare(`INSERT INTO audit_logs
    (id,organization_id,actor_id,action,entity_type,entity_id,after)
    VALUES (?,?,?,?,?,?,?)`).bind(createId("aud"),principal.organizationId,principal.userId,"agentic.work_task.created","work_task",taskId,
      JSON.stringify({taskNumber,title,priority,assigneeUserId,source:"agentic-employees"})));
  await env.FINANCE_DB.batch(statements);
  return { taskId, taskNumber, title, priority, assigneeUserId };
}
