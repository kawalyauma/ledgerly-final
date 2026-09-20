import type { Pool } from "pg";
import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import { createId } from "../../core-identity/security.js";

export type LedgerlyAiChatRow = {
  id: string;
  organizationId: string;
  createdBy: string;
  agentId: string | null;
  title: string;
  status: "active" | "archived" | "deleted";
  metadata: Record<string, unknown>;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LedgerlyAiMessageRow = {
  id: string;
  chatId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  userId: string | null;
  agentId: string | null;
  correlationId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

function mapChat(row: Record<string, unknown>): LedgerlyAiChatRow {
  return {
    id: String(row.id),
    organizationId: String(row.organizationId),
    createdBy: String(row.createdBy),
    agentId: row.agentId ? String(row.agentId) : null,
    title: String(row.title),
    status: row.status as LedgerlyAiChatRow["status"],
    metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>,
    lastMessageAt: row.lastMessageAt ? String(row.lastMessageAt) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

function mapMessage(row: Record<string, unknown>): LedgerlyAiMessageRow {
  return {
    id: String(row.id),
    chatId: String(row.chatId),
    role: row.role as LedgerlyAiMessageRow["role"],
    content: String(row.content),
    userId: row.userId ? String(row.userId) : null,
    agentId: row.agentId ? String(row.agentId) : null,
    correlationId: String(row.correlationId),
    metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>,
    createdAt: String(row.createdAt),
  };
}

export class LedgerlyAiGatewayRepository {
  constructor(private readonly db: Pool) {}

  async createChat(input: { principal: AuthPrincipal; title: string; agentId?: string | null; metadata?: Record<string, unknown> }) {
    const id = createId("laic");
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO lai_chats(id,organization_id,created_by,agent_id,title,status,metadata_json)
       VALUES($1,$2,$3,$4,$5,'active',$6::jsonb)
       RETURNING id,organization_id AS "organizationId",created_by AS "createdBy",agent_id AS "agentId",
                 title,status,metadata_json AS metadata,last_message_at AS "lastMessageAt",
                 created_at AS "createdAt",updated_at AS "updatedAt"`,
      [id, input.principal.organizationId, input.principal.userId, input.agentId ?? null, input.title, JSON.stringify(input.metadata ?? {})],
    );
    return mapChat(result.rows[0]!);
  }

  async getChat(principal: AuthPrincipal, id: string, includeDeleted = false) {
    const admin = principal.role === "owner" || principal.role === "admin";
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,organization_id AS "organizationId",created_by AS "createdBy",agent_id AS "agentId",
              title,status,metadata_json AS metadata,last_message_at AS "lastMessageAt",
              created_at AS "createdAt",updated_at AS "updatedAt"
         FROM lai_chats
        WHERE id=$1 AND organization_id=$2
          AND ($3::boolean OR created_by=$4)
          AND ($5::boolean OR status<>'deleted')`,
      [id, principal.organizationId, admin, principal.userId, includeDeleted],
    );
    if (!result.rows[0]) throw new AppError(404, "LEDGERLY_AI_CHAT_NOT_FOUND", "Ledgerly AI chat not found.");
    return mapChat(result.rows[0]);
  }

  async listChats(principal: AuthPrincipal, status?: "active" | "archived") {
    const admin = principal.role === "owner" || principal.role === "admin";
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,organization_id AS "organizationId",created_by AS "createdBy",agent_id AS "agentId",
              title,status,metadata_json AS metadata,last_message_at AS "lastMessageAt",
              created_at AS "createdAt",updated_at AS "updatedAt"
         FROM lai_chats
        WHERE organization_id=$1
          AND ($2::boolean OR created_by=$3)
          AND status<>'deleted'
          AND ($4::text IS NULL OR status=$4)
        ORDER BY COALESCE(last_message_at,created_at) DESC
        LIMIT 200`,
      [principal.organizationId, admin, principal.userId, status ?? null],
    );
    return result.rows.map(mapChat);
  }

  async listMyChats(principal:AuthPrincipal,status?: "active"|"archived"){
    const result=await this.db.query<Record<string,unknown>>(
      `SELECT id,organization_id AS "organizationId",created_by AS "createdBy",agent_id AS "agentId",
              title,status,metadata_json AS metadata,last_message_at AS "lastMessageAt",
              created_at AS "createdAt",updated_at AS "updatedAt"
         FROM lai_chats
        WHERE organization_id=$1 AND created_by=$2 AND status<>'deleted'
          AND ($3::text IS NULL OR status=$3)
        ORDER BY COALESCE(last_message_at,created_at) DESC
        LIMIT 200`,
      [principal.organizationId,principal.userId,status??null],
    );
    return result.rows.map(mapChat);
  }

  async getMyChat(principal:AuthPrincipal,id:string){
    const result=await this.db.query<Record<string,unknown>>(
      `SELECT id,organization_id AS "organizationId",created_by AS "createdBy",agent_id AS "agentId",
              title,status,metadata_json AS metadata,last_message_at AS "lastMessageAt",
              created_at AS "createdAt",updated_at AS "updatedAt"
         FROM lai_chats
        WHERE id=$1 AND organization_id=$2 AND created_by=$3 AND status<>'deleted'
        LIMIT 1`,
      [id,principal.organizationId,principal.userId],
    );
    if(!result.rows[0])throw new AppError(404,"LEDGERLY_AI_CHAT_NOT_FOUND","Ledgerly AI chat not found.");
    return mapChat(result.rows[0]);
  }

  async listMyChatMessages(principal:AuthPrincipal,chatId:string,limit=200){
    await this.getMyChat(principal,chatId);
    const result=await this.db.query<Record<string,unknown>>(
      `SELECT id,chat_id AS "chatId",role,content,user_id AS "userId",agent_id AS "agentId",
              correlation_id AS "correlationId",metadata_json AS metadata,created_at AS "createdAt"
         FROM lai_messages
        WHERE organization_id=$1 AND chat_id=$2
        ORDER BY created_at,id LIMIT $3`,
      [principal.organizationId,chatId,limit],
    );
    return result.rows.map(mapMessage);
  }

  async updateChat(principal: AuthPrincipal, id: string, changes: { title?: string; status?: "active" | "archived" | "deleted" }) {
    await this.getChat(principal, id, true);
    const result = await this.db.query<Record<string, unknown>>(
      `UPDATE lai_chats
          SET title=COALESCE($1,title),status=COALESCE($2,status),updated_at=CURRENT_TIMESTAMP
        WHERE id=$3 AND organization_id=$4
        RETURNING id,organization_id AS "organizationId",created_by AS "createdBy",agent_id AS "agentId",
                  title,status,metadata_json AS metadata,last_message_at AS "lastMessageAt",
                  created_at AS "createdAt",updated_at AS "updatedAt"`,
      [changes.title ?? null, changes.status ?? null, id, principal.organizationId],
    );
    return mapChat(result.rows[0]!);
  }

  async listMessages(principal: AuthPrincipal, chatId: string, limit = 200) {
    await this.getChat(principal, chatId);
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,chat_id AS "chatId",role,content,user_id AS "userId",agent_id AS "agentId",
              correlation_id AS "correlationId",metadata_json AS metadata,created_at AS "createdAt"
         FROM lai_messages
        WHERE organization_id=$1 AND chat_id=$2
        ORDER BY created_at,id
        LIMIT $3`,
      [principal.organizationId, chatId, limit],
    );
    return result.rows.map(mapMessage);
  }

  async recentMessages(principal: AuthPrincipal, chatId: string, limit: number) {
    await this.getChat(principal, chatId);
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT id,chat_id AS "chatId",role,content,user_id AS "userId",agent_id AS "agentId",
              correlation_id AS "correlationId",metadata_json AS metadata,created_at AS "createdAt"
         FROM (
           SELECT * FROM lai_messages
            WHERE organization_id=$1 AND chat_id=$2 AND role IN ('user','assistant')
              AND COALESCE(metadata_json->>'kind','')<>'progress'
            ORDER BY created_at DESC,id DESC LIMIT $3
         ) m
        ORDER BY created_at,id`,
      [principal.organizationId, chatId, limit],
    );
    return result.rows.map(mapMessage);
  }

  async appendMessage(input: {
    principal: AuthPrincipal;
    chatId: string;
    role: LedgerlyAiMessageRow["role"];
    content: string;
    correlationId: string;
    agentId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    await this.getChat(input.principal, input.chatId);
    const id = createId("laim");
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO lai_messages(id,organization_id,chat_id,role,content,user_id,agent_id,correlation_id,metadata_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING id,chat_id AS "chatId",role,content,user_id AS "userId",agent_id AS "agentId",
                 correlation_id AS "correlationId",metadata_json AS metadata,created_at AS "createdAt"`,
      [id, input.principal.organizationId, input.chatId, input.role, input.content, input.role === "user" ? input.principal.userId : null,
       input.agentId ?? null, input.correlationId, JSON.stringify(input.metadata ?? {})],
    );
    await this.db.query(
      "UPDATE lai_chats SET last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2",
      [input.chatId, input.principal.organizationId],
    );
    return mapMessage(result.rows[0]!);
  }

  async createJob(input: { principal: AuthPrincipal; chatId: string; agentId?: string | null; correlationId: string; taskKind: string; request: Record<string, unknown> }) {
    const id = createId("laij");
    await this.db.query(
      `INSERT INTO lai_jobs(id,organization_id,kind,agent_id,chat_id,created_by,status,risk_level,correlation_id,input_json)
       VALUES($1,$2,$3,$4,$5,$6,'queued','low',$7,$8::jsonb)`,
      [id, input.principal.organizationId, input.taskKind, input.agentId ?? null, input.chatId,
       input.principal.userId, input.correlationId, JSON.stringify(input.request)],
    );
    return id;
  }

  async startJob(organizationId: string, id: string) {
    await this.db.query("UPDATE lai_jobs SET status='running',started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2", [id, organizationId]);
  }

  async waitingJob(organizationId: string, id: string, result: Record<string, unknown>) {
    await this.db.query(
      "UPDATE lai_jobs SET status='waiting_approval',result_json=$1::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3",
      [JSON.stringify(result), id, organizationId],
    );
  }

  async completeJob(organizationId: string, id: string, result: Record<string, unknown>) {
    await this.db.query(
      "UPDATE lai_jobs SET status='completed',result_json=$1::jsonb,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3",
      [JSON.stringify(result), id, organizationId],
    );
  }

  async failJob(organizationId: string, id: string, error: string) {
    await this.db.query(
      "UPDATE lai_jobs SET status='failed',error_text=$1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3",
      [error.slice(0, 4000), id, organizationId],
    );
  }

  async listUserJobs(principal:AuthPrincipal,limit=50){
    const result=await this.db.query(
      `SELECT j.id,j.kind,j.status,j.risk_level AS "riskLevel",j.agent_id AS "agentId",
              a.display_name AS "agentName",j.chat_id AS "chatId",j.error_text AS error,
              j.result_json AS result,j.started_at AS "startedAt",j.completed_at AS "completedAt",
              j.created_at AS "createdAt",j.updated_at AS "updatedAt"
         FROM lai_jobs j
         LEFT JOIN lai_agents a ON a.id=j.agent_id AND a.organization_id=j.organization_id
        WHERE j.organization_id=$1 AND j.created_by=$2
        ORDER BY j.created_at DESC LIMIT $3`,
      [principal.organizationId,principal.userId,Math.min(Math.max(limit,1),100)],
    );
    return result.rows;
  }

  async audit(input: {
    principal: AuthPrincipal;
    action: string;
    entityType: string;
    entityId?: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.db.query(
      `INSERT INTO lai_audit_events(id,organization_id,actor_type,actor_id,action,entity_type,entity_id,correlation_id,metadata_json)
       VALUES($1,$2,'user',$3,$4,$5,$6,$7,$8::jsonb)`,
      [createId("laia"), input.principal.organizationId, input.principal.userId, input.action, input.entityType,
       input.entityId ?? null, input.correlationId, JSON.stringify(input.metadata ?? {})],
    );
  }
}
