import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { requireScope } from "../../../src/lib/auth";
import { createId } from "../../../src/lib/ids";
import { resolveLightReferences } from "./light-reference-resolver";

export const agenticChatStudioRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type ActionRow = {
  id: string;
  agentKey: string;
  actionType: string;
  title: string;
  summary: string;
  requiredScope: string;
  payloadJson: string;
  idempotencyKey: string;
  status: string;
  approvalId?: string | null;
  resultEntityType?: string | null;
  resultEntityId?: string | null;
  failureText?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ConversationRow = { id: string; agentKey: string; title: string; status: string; lastMessageAt?: string | null; createdAt?: string };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(422, "VALIDATION_ERROR", "Approval details must be a JSON object");
  return value as Record<string, unknown>;
}

function parsePayload(value: string | null | undefined) {
  try { return object(JSON.parse(value || "{}")); }
  catch { throw new AppError(422, "INVALID_ACTION_PAYLOAD", "Saved action payload is invalid"); }
}

function canUseScope(principal: AppVariables["principal"], scope: string) {
  return principal.role === "owner" || principal.role === "admin" || principal.scopes.includes(scope);
}

async function assertConversation(db: D1Database, organizationId: string, id: string) {
  const row = await db.prepare(`SELECT id,agent_key AS agentKey,title,status,last_message_at AS lastMessageAt,created_at AS createdAt
    FROM ae_conversations WHERE id=? AND organization_id=?`)
    .bind(id, organizationId).first<ConversationRow>();
  if (!row) throw new AppError(404, "NOT_FOUND", "AI conversation not found");
  return row;
}

async function getAction(db: D1Database, organizationId: string, id: string): Promise<ActionRow & { payload: Record<string, unknown> }> {
  const row = await db.prepare(`SELECT id,agent_key AS agentKey,action_type AS actionType,title,summary,required_scope AS requiredScope,
    payload_json AS payloadJson,idempotency_key AS idempotencyKey,status,approval_id AS approvalId,
    result_entity_type AS resultEntityType,result_entity_id AS resultEntityId,failure_text AS failureText,
    created_at AS createdAt,updated_at AS updatedAt FROM ae_actions WHERE id=? AND organization_id=?`)
    .bind(id, organizationId).first<ActionRow>();
  if (!row) throw new AppError(404, "NOT_FOUND", "AI action not found");
  return { ...row, payload: parsePayload(row.payloadJson) };
}

function normalizeEditablePayload(action: ActionRow & { payload: Record<string, unknown> }, candidateValue: unknown): Record<string, unknown> {
  const candidate = object(candidateValue);
  const original = action.payload;
  switch (action.actionType) {
    case "document.generate": {
      const title = String(candidate.title ?? original.title ?? "").trim().slice(0, 240);
      const format = String(candidate.format ?? original.format ?? "").toLowerCase();
      const spec = object(candidate.spec ?? original.spec ?? {});
      if (!title) throw new AppError(422, "VALIDATION_ERROR", "Document title is required");
      if (!["pdf", "docx", "xlsx", "pptx"].includes(format)) throw new AppError(422, "VALIDATION_ERROR", "Format must be PDF, DOCX, XLSX or PPTX");
      return { title, format, spec, conversationId: original.conversationId ?? null };
    }
    case "system.api.request": {
      return {
        agentKey: original.agentKey,
        method: original.method,
        path: original.path,
        body: candidate.body === undefined ? original.body : candidate.body,
      };
    }
    case "communication.campaign.send": {
      const channels = Array.isArray(candidate.channels) ? candidate.channels.map(String).filter(x => x === "sms" || x === "whatsapp").slice(0, 2) : original.channels;
      const subject = String(candidate.subject ?? original.subject ?? "").trim().slice(0, 200);
      const message = String(candidate.message ?? original.message ?? "").trim().slice(0, 2000);
      const audience = object(candidate.audience ?? original.audience ?? {});
      if (!message) throw new AppError(422, "VALIDATION_ERROR", "Communication message is required");
      return { audience, channels, subject, message };
    }
    case "work.task.create": {
      const title = String(candidate.title ?? original.title ?? "").trim().slice(0, 240);
      if (!title) throw new AppError(422, "VALIDATION_ERROR", "Task title is required");
      const priority = String(candidate.priority ?? original.priority ?? "medium");
      if (!["low", "medium", "high", "urgent"].includes(priority)) throw new AppError(422, "VALIDATION_ERROR", "Invalid task priority");
      return {
        title,
        description: String(candidate.description ?? original.description ?? "").slice(0, 10000),
        priority,
        assigneeUserId: candidate.assigneeUserId ?? original.assigneeUserId ?? null,
        dueAt: candidate.dueAt ?? original.dueAt ?? null,
      };
    }
    case "printerly.document.print": {
      const copies = Math.max(1, Math.min(1000, Number(candidate.copies ?? original.copies ?? 1) || 1));
      return {
        documentId: original.documentId,
        printerId: candidate.printerId ?? original.printerId ?? null,
        copies,
        estimatedPages: candidate.estimatedPages ?? original.estimatedPages,
        pageSize: String(candidate.pageSize ?? original.pageSize ?? "A4"),
        colorMode: String(candidate.colorMode ?? original.colorMode ?? "monochrome"),
        duplex: Boolean(candidate.duplex ?? original.duplex),
        secureRelease: Boolean(candidate.secureRelease ?? original.secureRelease),
        priority: String(candidate.priority ?? original.priority ?? "normal"),
      };
    }
    default:
      throw new AppError(409, "ACTION_NOT_EDITABLE", "This action type is not editable in chat");
  }
}

async function reResolveEditedSystemBody(db: D1Database, organizationId: string, action: ActionRow, payload: Record<string, unknown>) {
  if (action.actionType !== "system.api.request" || payload.body === undefined || payload.body === null) return payload;
  if (typeof payload.body !== "object" || Array.isArray(payload.body)) throw new AppError(422, "VALIDATION_ERROR", "Edited API request body must be a JSON object");
  const resolved = await resolveLightReferences(db, organizationId, payload.body);
  if (resolved.issues.length) throw new AppError(422, "VALIDATION_ERROR", resolved.issues.join(" "));
  payload.body = resolved.value;
  return payload;
}

function phaseForTool(name: string) {
  const value = name.toLowerCase();
  if (value === "light_route_type" || value === "light_build_registry") return "thinking";
  if (value === "light_route_module" || value === "light_route_group" || value === "light_route_tool") return "analyzing_data";
  if (value.startsWith("light_extract_")) return "querying_ledgerly";
  if (value === "light_build_document") return "building_document";
  if (value === "light_write_answer") return "writing";
  if (value.includes("document")) return "building_document";
  if (value.includes("system_read") || value.includes("search") || value.includes("lookup") || value.includes("overview") || value.includes("summary") || value.includes("report") || value.startsWith("get_") || value.startsWith("list_")) return "querying_ledgerly";
  if (value.includes("prepare_system_action") || value.includes("prepare_communication") || value.includes("prepare_work_task") || value.startsWith("create_") || value.startsWith("update_") || value.startsWith("delete_") || value.startsWith("action_")) return "preparing_approval";
  if (value.includes("memory")) return "checking_memory";
  if (value.includes("timetable")) return "analyzing_data";
  return "analyzing_data";
}

async function conversationActions(db: D1Database, organizationId: string, conversationId: string) {
  const pattern = `conversation:${conversationId}:%`;
  const rows = await db.prepare(`SELECT id,agent_key AS agentKey,action_type AS actionType,title,summary,required_scope AS requiredScope,
    payload_json AS payloadJson,status,approval_id AS approvalId,result_entity_type AS resultEntityType,
    result_entity_id AS resultEntityId,failure_text AS failureText,created_at AS createdAt,updated_at AS updatedAt
    FROM ae_actions WHERE organization_id=? AND idempotency_key LIKE ? ORDER BY created_at, id`)
    .bind(organizationId, pattern).all<ActionRow>();
  return rows.results.map(row => ({ ...row, payload: parsePayload(row.payloadJson), payloadJson: undefined }));
}

async function conversationArtifacts(db: D1Database, organizationId: string, conversationId: string) {
  const rows = await db.prepare(`SELECT id,title,format,source_mime_type AS sourceMimeType,source_size_bytes AS sourceSizeBytes,
    pdf_size_bytes AS pdfSizeBytes,pdf_page_count AS pdfPageCount,status,created_at AS createdAt
    FROM ae_generated_documents WHERE organization_id=? AND conversation_id=? AND status<>'deleted' ORDER BY created_at DESC`)
    .bind(organizationId, conversationId).all();
  return rows.results;
}

agenticChatStudioRoutes.get("/chat-studio/conversations/:id/actions", requireScope("school:read"), async c => {
  const principal = c.get("principal"), id = c.req.param("id");
  await assertConversation(c.env.FINANCE_DB, principal.organizationId, id);
  return c.json({ data: await conversationActions(c.env.FINANCE_DB, principal.organizationId, id) });
});

agenticChatStudioRoutes.get("/chat-studio/conversations/:id/artifacts", requireScope("school:read"), async c => {
  const principal = c.get("principal"), id = c.req.param("id");
  await assertConversation(c.env.FINANCE_DB, principal.organizationId, id);
  return c.json({ data: await conversationArtifacts(c.env.FINANCE_DB, principal.organizationId, id) });
});

agenticChatStudioRoutes.get("/chat-studio/conversations/:id/status", requireScope("school:read"), async c => {
  const principal = c.get("principal"), id = c.req.param("id");
  await assertConversation(c.env.FINANCE_DB, principal.organizationId, id);
  const tools = await c.env.FINANCE_DB.prepare(`SELECT id,tool_name AS toolName,status,error_text AS errorText,created_at AS createdAt,completed_at AS completedAt
    FROM ae_tool_calls WHERE organization_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 12`)
    .bind(principal.organizationId, id).all<{ id: string; toolName: string; status: string; errorText?: string }>();
  const actions = await conversationActions(c.env.FINANCE_DB, principal.organizationId, id);
  const running = tools.results.find(item => item.status === "running");
  const waiting = actions.some(item => ["suggested", "prepared", "awaiting_approval", "approved"].includes(String(item.status)));
  const phase = running ? phaseForTool(running.toolName) : waiting ? "waiting_for_approval" : "thinking";
  return c.json({ data: { phase, activeTool: running?.toolName || null, tools: tools.results, waitingForApproval: waiting } });
});

agenticChatStudioRoutes.post("/chat-studio/conversations/:id/close", requireScope("school:read"), async c => {
  const principal = c.get("principal"), id = c.req.param("id");
  const conversation = await assertConversation(c.env.FINANCE_DB, principal.organizationId, id);
  if (conversation.status !== "closed") {
    await c.env.FINANCE_DB.batch([
      c.env.FINANCE_DB.prepare(`UPDATE ae_conversations SET status='closed',updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND organization_id=? AND status<>'closed'`).bind(id, principal.organizationId),
      c.env.FINANCE_DB.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after)
        VALUES(?,?,?,?,?,?,?)`).bind(createId("aud"), principal.organizationId, principal.userId, "agentic.conversation.closed", "ae_conversation", id, JSON.stringify({ status: "closed" })),
    ]);
  }
  return c.json({ data: { ...conversation, status: "closed" } });
});

agenticChatStudioRoutes.patch("/chat-studio/actions/:id/payload", requireScope("school:read"), async c => {
  const principal = c.get("principal");
  const action = await getAction(c.env.FINANCE_DB, principal.organizationId, c.req.param("id"));
  if (action.status !== "suggested") throw new AppError(409, "ACTION_LOCKED", "Only an unapproved suggested action can be edited");
  if (!canUseScope(principal, action.requiredScope)) throw new AppError(403, "FORBIDDEN", `Editing this action requires ${action.requiredScope}`);
  const body = object(await c.req.json());
  let payload = normalizeEditablePayload(action, body.payload);
  payload = await reResolveEditedSystemBody(c.env.FINANCE_DB, principal.organizationId, action, payload);
  const title = action.actionType === "document.generate" ? `Generate ${String(payload.title)}`.slice(0, 240) : action.title;
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare("UPDATE ae_actions SET payload_json=?,title=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='suggested'")
      .bind(JSON.stringify(payload), title, action.id, principal.organizationId),
    c.env.FINANCE_DB.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after)
      VALUES(?,?,?,?,?,?,?)`).bind(createId("aud"), principal.organizationId, principal.userId, "agentic.action.edited_in_chat", "ae_action", action.id, JSON.stringify({ actionType: action.actionType, payload })),
  ]);
  return c.json({ data: await getAction(c.env.FINANCE_DB, principal.organizationId, action.id) });
});
