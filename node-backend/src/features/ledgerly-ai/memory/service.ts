import type { Pool, PoolClient } from "pg";
import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import { createId } from "../../core-identity/security.js";
import type { LedgerlyAiConfig } from "../config.js";
import type { LedgerlyAiGatewayRepository } from "../gateway/repository.js";
import { redactLedgerlyAiText, redactLedgerlyAiValue } from "../gateway/redaction.js";
import type {
  LedgerlyAiMemoryCreate,
  LedgerlyAiMemoryKind,
  LedgerlyAiMemoryRecord,
  LedgerlyAiMemoryScope,
} from "./types.js";

type Db = Pool | PoolClient;

type MemoryRow = {
  id: string;
  organizationId: string;
  scopeType: LedgerlyAiMemoryScope;
  scopeId: string;
  kind: LedgerlyAiMemoryKind;
  title: string | null;
  content: string;
  importance: number | string;
  confidence: number | string;
  sourceType: string;
  sourceId: string | null;
  requiredScope: string | null;
  pinned: boolean;
  correctionOfId: string | null;
  status: "active" | "expired" | "deleted";
  metadata: Record<string, unknown> | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number | string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  relevance?: number | string;
};

function isAdmin(principal: AuthPrincipal) {
  return principal.role === "owner" || principal.role === "admin";
}

function hasScope(principal: AuthPrincipal, scope: string) {
  return isAdmin(principal) || principal.scopes.includes(scope);
}

function mapMemory(row: MemoryRow): LedgerlyAiMemoryRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    kind: row.kind,
    title: row.title,
    content: row.content,
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    requiredScope: row.requiredScope,
    pinned: Boolean(row.pinned),
    correctionOfId: row.correctionOfId,
    status: row.status,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    useCount: Number(row.useCount),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.relevance === undefined ? {} : { relevance: Number(row.relevance) }),
  };
}

const selectColumns = `
  id,
  organization_id AS "organizationId",
  scope_type AS "scopeType",
  scope_id AS "scopeId",
  memory_kind AS kind,
  title,
  content,
  importance,
  confidence,
  source_type AS "sourceType",
  source_id AS "sourceId",
  required_scope AS "requiredScope",
  pinned,
  correction_of_id AS "correctionOfId",
  status,
  metadata_json AS metadata,
  expires_at AS "expiresAt",
  last_used_at AS "lastUsedAt",
  use_count AS "useCount",
  created_by AS "createdBy",
  updated_by AS "updatedBy",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export class LedgerlyAiMemoryService {
  constructor(
    private readonly db: Pool,
    private readonly chats: LedgerlyAiGatewayRepository,
    private readonly config: LedgerlyAiConfig,
  ) {}

  private async audit(db: Db, input: {
    organizationId: string;
    memoryId?: string | null;
    actorType: "user" | "agent" | "system";
    actorId: string;
    action: "created" | "updated" | "corrected" | "expired" | "deleted" | "retrieved" | "restored";
    scopeType?: LedgerlyAiMemoryScope | null;
    scopeId?: string | null;
    correlationId?: string | null;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  }) {
    await db.query(
      `INSERT INTO lai_memory_audit(
        id,organization_id,memory_id,actor_type,actor_id,action,scope_type,scope_id,
        correlation_id,reason,before_json,after_json,metadata_json
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)`,
      [
        createId("laima"),
        input.organizationId,
        input.memoryId ?? null,
        input.actorType,
        input.actorId,
        input.action,
        input.scopeType ?? null,
        input.scopeId ?? null,
        input.correlationId ?? null,
        input.reason ?? null,
        input.before === undefined ? null : JSON.stringify(redactLedgerlyAiValue(input.before)),
        input.after === undefined ? null : JSON.stringify(redactLedgerlyAiValue(input.after)),
        JSON.stringify(redactLedgerlyAiValue(input.metadata ?? {})),
      ],
    );
  }

  private async assertProject(principal: AuthPrincipal, projectId: string, write: boolean) {
    const project = await this.db.query(
      "SELECT 1 FROM work_projects WHERE id=$1 AND organization_id=$2",
      [projectId, principal.organizationId],
    );
    if (!project.rowCount) throw new AppError(404, "LEDGERLY_AI_MEMORY_PROJECT_NOT_FOUND", "Project not found.");
    const permitted = write
      ? hasScope(principal, "work:write")
      : hasScope(principal, "work:read") || hasScope(principal, "work:write");
    if (!permitted) throw new AppError(403, "FORBIDDEN", "Project memory access is not permitted.");
  }

  private async assertAgentReadable(principal: AuthPrincipal, agentId: string) {
    if (isAdmin(principal)) return;
    const agent = await this.db.query<{kind:string;createdBy:string|null}>(
      `SELECT kind,created_by AS "createdBy" FROM lai_agents
        WHERE id=$1 AND organization_id=$2 AND status<>'disabled' LIMIT 1`,
      [agentId,principal.organizationId],
    );
    const row=agent.rows[0];
    if(!row)throw new AppError(404,"LEDGERLY_AI_MEMORY_AGENT_NOT_FOUND","Ledgerly AI employee not found.");
    if(row.kind==="custom"&&row.createdBy!==principal.userId){
      const shared=await this.db.query(
        `SELECT 1 FROM lai_custom_agent_shares s
          WHERE s.organization_id=$1 AND s.agent_id=$2 AND (
            (s.subject_type='user' AND s.subject_id=$3)
            OR (s.subject_type='role' AND s.subject_id=$4)
            OR (s.subject_type='organization' AND s.subject_id='')
            OR (s.subject_type='department' AND EXISTS(
              SELECT 1 FROM school_staff_profiles sp
               WHERE sp.organization_id=$1 AND sp.user_id=$3
                 AND sp.department_id=s.subject_id AND sp.deleted_at IS NULL
                 AND sp.employment_status IN ('active','on_leave')
            ))
          ) LIMIT 1`,
        [principal.organizationId,agentId,principal.userId,principal.role],
      );
      if(!shared.rowCount)throw new AppError(403,"FORBIDDEN","Agent memory access is not permitted.");
    }
    const chat = await this.db.query(
      `SELECT 1 FROM lai_chats
        WHERE organization_id=$1 AND created_by=$2 AND agent_id=$3 AND status<>'deleted'
        LIMIT 1`,
      [principal.organizationId, principal.userId, agentId],
    );
    if (!chat.rowCount) throw new AppError(403, "FORBIDDEN", "Agent memory access is not permitted.");
  }
  private async resolveScope(
    principal: AuthPrincipal,
    scopeType: LedgerlyAiMemoryScope,
    requestedScopeId: string | null | undefined,
    write: boolean,
  ): Promise<string> {
    switch (scopeType) {
      case "user": {
        if (requestedScopeId && requestedScopeId !== principal.userId && !isAdmin(principal)) {
          throw new AppError(403, "FORBIDDEN", "Users may access only their own personal memory.");
        }
        const userId = requestedScopeId && isAdmin(principal) ? requestedScopeId : principal.userId;
        const membership = await this.db.query(
          "SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2 LIMIT 1",
          [principal.organizationId, userId],
        );
        if (!membership.rowCount) throw new AppError(404, "LEDGERLY_AI_MEMORY_USER_NOT_FOUND", "User not found in this organization.");
        return userId;
      }
      case "chat": {
        if (!requestedScopeId) throw new AppError(422, "MEMORY_SCOPE_REQUIRED", "A chat ID is required.");
        await this.chats.getChat(principal, requestedScopeId);
        return requestedScopeId;
      }
      case "agent": {
        if (!requestedScopeId) throw new AppError(422, "MEMORY_SCOPE_REQUIRED", "An agent ID is required.");
        const agent = await this.db.query(
          "SELECT 1 FROM lai_agents WHERE id=$1 AND organization_id=$2 AND status<>'disabled' LIMIT 1",
          [requestedScopeId, principal.organizationId],
        );
        if (!agent.rowCount) throw new AppError(404, "LEDGERLY_AI_MEMORY_AGENT_NOT_FOUND", "Ledgerly AI employee not found.");
        if (write && !isAdmin(principal) && !principal.scopes.includes("admin:write")) {
          throw new AppError(403, "FORBIDDEN", "Agent memory changes require administrative permission.");
        }
        if (!write) await this.assertAgentReadable(principal, requestedScopeId);
        return requestedScopeId;
      }
      case "organization": {
        if (requestedScopeId && requestedScopeId !== principal.organizationId) {
          throw new AppError(403, "FORBIDDEN", "Organization memory cannot cross tenant boundaries.");
        }
        if (write && !isAdmin(principal) && !principal.scopes.includes("admin:write")) {
          throw new AppError(403, "FORBIDDEN", "Organization memory changes require administrative permission.");
        }
        return principal.organizationId;
      }
      case "project": {
        if (!requestedScopeId) throw new AppError(422, "MEMORY_SCOPE_REQUIRED", "A project ID is required.");
        await this.assertProject(principal, requestedScopeId, write);
        return requestedScopeId;
      }
      default:
        throw new AppError(422, "MEMORY_SCOPE_INVALID", "Unsupported memory scope.");
    }
  }

  private async expireDue(organizationId: string) {
    const result = await this.db.query<{ id: string; scopeType: LedgerlyAiMemoryScope; scopeId: string }>(
      `UPDATE lai_memories
          SET status='expired',updated_at=CURRENT_TIMESTAMP
        WHERE organization_id=$1 AND status='active'
          AND expires_at IS NOT NULL AND expires_at<=CURRENT_TIMESTAMP
        RETURNING id,scope_type AS "scopeType",scope_id AS "scopeId"`,
      [organizationId],
    );
    for (const row of result.rows) {
      await this.audit(this.db, {
        organizationId,
        memoryId: row.id,
        actorType: "system",
        actorId: "ledgerly-ai",
        action: "expired",
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        reason: "Memory expiry time reached",
        metadata: { automatic: true },
      });
    }
  }

  async create(principal: AuthPrincipal, input: LedgerlyAiMemoryCreate, correlationId?: string) {
    const scopeId = await this.resolveScope(principal, input.scopeType, input.scopeId, true);
    if (input.requiredScope && !isAdmin(principal)) {
      throw new AppError(403, "FORBIDDEN", "Only administrators may assign a required permission scope to memory.");
    }
    const id = createId("laimem");
    const result = await this.db.query<MemoryRow>(
      `INSERT INTO lai_memories(
        id,organization_id,scope_type,scope_id,memory_kind,title,content,importance,confidence,
        source_type,source_id,required_scope,pinned,status,metadata_json,expires_at,created_by,updated_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14::jsonb,$15,$16,$16)
      RETURNING ${selectColumns}`,
      [
        id,
        principal.organizationId,
        input.scopeType,
        scopeId,
        input.kind ?? "fact",
        input.title?.trim() || null,
        redactLedgerlyAiText(input.content.trim()),
        input.importance ?? 0.5,
        input.confidence ?? 1,
        input.sourceType ?? "manual",
        input.sourceId ?? null,
        input.requiredScope ?? null,
        input.pinned ?? false,
        JSON.stringify(redactLedgerlyAiValue(input.metadata ?? {})),
        input.expiresAt ?? null,
        principal.userId,
      ],
    );
    const memory = mapMemory(result.rows[0]!);
    await this.audit(this.db, {
      organizationId: principal.organizationId,
      memoryId: memory.id,
      actorType: "user",
      actorId: principal.userId,
      action: "created",
      scopeType: memory.scopeType,
      scopeId: memory.scopeId,
      correlationId,
      after: memory,
    });
    return memory;
  }

  async get(principal: AuthPrincipal, id: string, write = false) {
    await this.expireDue(principal.organizationId);
    const result = await this.db.query<MemoryRow>(
      `SELECT ${selectColumns}
         FROM lai_memories
        WHERE id=$1 AND organization_id=$2`,
      [id, principal.organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "LEDGERLY_AI_MEMORY_NOT_FOUND", "Memory not found.");
    const memory = mapMemory(row);
    await this.resolveScope(principal, memory.scopeType, memory.scopeId, write);
    if (memory.requiredScope && !hasScope(principal, memory.requiredScope)) {
      throw new AppError(403, "FORBIDDEN", "You do not have permission to access this memory.");
    }
    return memory;
  }

  async list(principal: AuthPrincipal, input: {
    scopeType?: LedgerlyAiMemoryScope;
    scopeId?: string | null;
    status?: "active" | "expired" | "deleted";
    limit?: number;
  }) {
    const scopeType = input.scopeType ?? "user";
    const scopeId = await this.resolveScope(principal, scopeType, input.scopeId, false);
    await this.expireDue(principal.organizationId);
    const result = await this.db.query<MemoryRow>(
      `SELECT ${selectColumns}
         FROM lai_memories
        WHERE organization_id=$1 AND scope_type=$2 AND scope_id=$3
          AND status=$4
          AND ($5::boolean OR required_scope IS NULL OR required_scope=ANY($6::text[]))
        ORDER BY pinned DESC,importance DESC,updated_at DESC
        LIMIT $7`,
      [
        principal.organizationId,
        scopeType,
        scopeId,
        input.status ?? "active",
        isAdmin(principal),
        principal.scopes,
        Math.min(Math.max(input.limit ?? 100, 1), 500),
      ],
    );
    return result.rows.map(mapMemory);
  }

  async update(principal: AuthPrincipal, id: string, changes: {
    title?: string | null;
    content?: string;
    kind?: LedgerlyAiMemoryKind;
    importance?: number;
    confidence?: number;
    requiredScope?: string | null;
    pinned?: boolean;
    expiresAt?: string | null;
    metadata?: Record<string, unknown>;
  }, correlationId?: string, reason?: string) {
    const before = await this.get(principal, id, true);
    if (before.status === "deleted") throw new AppError(409, "LEDGERLY_AI_MEMORY_DELETED", "Deleted memory must be restored before it can be edited.");
    if (changes.requiredScope !== undefined && !isAdmin(principal)) {
      throw new AppError(403, "FORBIDDEN", "Only administrators may change memory permission scopes.");
    }
    const result = await this.db.query<MemoryRow>(
      `UPDATE lai_memories SET
        title=CASE WHEN $1::boolean THEN $2 ELSE title END,
        content=COALESCE($3,content),
        memory_kind=COALESCE($4,memory_kind),
        importance=COALESCE($5,importance),
        confidence=COALESCE($6,confidence),
        required_scope=CASE WHEN $7::boolean THEN $8 ELSE required_scope END,
        pinned=COALESCE($9,pinned),
        expires_at=CASE WHEN $10::boolean THEN $11::timestamptz ELSE expires_at END,
        metadata_json=CASE WHEN $12::boolean THEN $13::jsonb ELSE metadata_json END,
        status=CASE WHEN $10::boolean AND $11::timestamptz IS NOT NULL AND $11::timestamptz<=CURRENT_TIMESTAMP THEN 'expired'
                    WHEN $10::boolean AND status='expired' AND ($11::timestamptz IS NULL OR $11::timestamptz>CURRENT_TIMESTAMP) THEN 'active'
                    ELSE status END,
        updated_by=$14,updated_at=CURRENT_TIMESTAMP
       WHERE id=$15 AND organization_id=$16
       RETURNING ${selectColumns}`,
      [
        Object.hasOwn(changes, "title"), changes.title?.trim() || null,
        changes.content ? redactLedgerlyAiText(changes.content.trim()) : null,
        changes.kind ?? null,
        changes.importance ?? null,
        changes.confidence ?? null,
        Object.hasOwn(changes, "requiredScope"), changes.requiredScope ?? null,
        changes.pinned ?? null,
        Object.hasOwn(changes, "expiresAt"), changes.expiresAt ?? null,
        Object.hasOwn(changes, "metadata"), JSON.stringify(redactLedgerlyAiValue(changes.metadata ?? {})),
        principal.userId,
        id,
        principal.organizationId,
      ],
    );
    const after = mapMemory(result.rows[0]!);
    await this.audit(this.db, {
      organizationId: principal.organizationId,
      memoryId: id,
      actorType: "user",
      actorId: principal.userId,
      action: "updated",
      scopeType: after.scopeType,
      scopeId: after.scopeId,
      correlationId,
      reason,
      before,
      after,
    });
    return after;
  }

  async correct(principal: AuthPrincipal, id: string, input: {
    title?: string | null;
    content: string;
    confidence?: number;
    reason?: string;
  }, correlationId?: string) {
    const before = await this.get(principal, id, true);
    if (before.status === "deleted") throw new AppError(409, "LEDGERLY_AI_MEMORY_DELETED", "Deleted memory cannot be corrected.");
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const newId = createId("laimem");
      const inserted = await client.query<MemoryRow>(
        `INSERT INTO lai_memories(
          id,organization_id,scope_type,scope_id,memory_kind,title,content,importance,confidence,
          source_type,source_id,required_scope,pinned,correction_of_id,status,metadata_json,expires_at,created_by,updated_by
        )
        SELECT $1,organization_id,scope_type,scope_id,memory_kind,$2,$3,importance,$4,
               'correction',id,required_scope,pinned,id,'active',metadata_json,expires_at,$5,$5
          FROM lai_memories WHERE id=$6 AND organization_id=$7
        RETURNING ${selectColumns}`,
        [newId, input.title === undefined ? before.title : input.title?.trim() || null, redactLedgerlyAiText(input.content.trim()),
         input.confidence ?? before.confidence, principal.userId, id, principal.organizationId],
      );
      await client.query(
        `UPDATE lai_memories SET status='expired',updated_by=$1,updated_at=CURRENT_TIMESTAMP
          WHERE id=$2 AND organization_id=$3`,
        [principal.userId, id, principal.organizationId],
      );
      const after = mapMemory(inserted.rows[0]!);
      await this.audit(client, {
        organizationId: principal.organizationId,
        memoryId: after.id,
        actorType: "user",
        actorId: principal.userId,
        action: "corrected",
        scopeType: after.scopeType,
        scopeId: after.scopeId,
        correlationId,
        reason: input.reason ?? "Memory correction",
        before,
        after,
        metadata: { supersedesMemoryId: id },
      });
      await client.query("COMMIT");
      return after;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setStatus(
    principal: AuthPrincipal,
    id: string,
    status: "expired" | "deleted" | "active",
    correlationId?: string,
    reason?: string,
  ) {
    const before = await this.get(principal, id, true);
    const action = status === "deleted" ? "deleted" : status === "expired" ? "expired" : "restored";
    const result = await this.db.query<MemoryRow>(
      `UPDATE lai_memories SET
          status=$1,
          deleted_at=CASE WHEN $1='deleted' THEN CURRENT_TIMESTAMP ELSE NULL END,
          deleted_by=CASE WHEN $1='deleted' THEN $2 ELSE NULL END,
          expires_at=CASE
            WHEN $1='active' AND expires_at IS NOT NULL AND expires_at<=CURRENT_TIMESTAMP THEN NULL
            ELSE expires_at
          END,
          updated_by=$2,updated_at=CURRENT_TIMESTAMP
        WHERE id=$3 AND organization_id=$4
        RETURNING ${selectColumns}`,
      [status, principal.userId, id, principal.organizationId],
    );
    const after = mapMemory(result.rows[0]!);
    await this.audit(this.db, {
      organizationId: principal.organizationId,
      memoryId: id,
      actorType: "user",
      actorId: principal.userId,
      action,
      scopeType: after.scopeType,
      scopeId: after.scopeId,
      correlationId,
      reason,
      before,
      after,
    });
    return after;
  }

  async captureConversationTurn(input: {
    principal: AuthPrincipal;
    chatId: string;
    agentId?: string | null;
    userMessageId: string;
    assistantMessageId: string;
    userText: string;
    assistantText: string;
    correlationId: string;
  }) {
    const content = redactLedgerlyAiText(
      `User: ${input.userText.slice(0, 5000)}\nLedgerly AI: ${input.assistantText.slice(0, 7000)}`,
    );
    const id = createId("laimem");
    const result = await this.db.query<MemoryRow>(
      `INSERT INTO lai_memories(
        id,organization_id,scope_type,scope_id,memory_kind,title,content,importance,confidence,
        source_type,source_id,status,metadata_json,expires_at,created_by,updated_by
      ) VALUES(
        $1,$2,'chat',$3,'summary','Conversation turn',$4,0.35,1,
        'conversation_turn',$5,'active',$6::jsonb,
        CURRENT_TIMESTAMP + ($7::text || ' days')::interval,$8,$8
      )
      ON CONFLICT DO NOTHING
      RETURNING ${selectColumns}`,
      [
        id,
        input.principal.organizationId,
        input.chatId,
        content,
        input.assistantMessageId,
        JSON.stringify({ userMessageId: input.userMessageId, assistantMessageId: input.assistantMessageId, agentId: input.agentId ?? null }),
        this.config.LEDGERLY_AI_SHORT_TERM_MEMORY_DAYS,
        input.principal.userId,
      ],
    );
    const row = result.rows[0];
    if (!row) return null;
    const memory = mapMemory(row);
    await this.audit(this.db, {
      organizationId: input.principal.organizationId,
      memoryId: memory.id,
      actorType: "system",
      actorId: "ledgerly-ai",
      action: "created",
      scopeType: "chat",
      scopeId: input.chatId,
      correlationId: input.correlationId,
      after: { id: memory.id, kind: memory.kind, expiresAt: memory.expiresAt, sourceType: memory.sourceType },
      metadata: { automatic: true },
    });
    return memory;
  }

  async captureCustomAgentTurn(input: {
    principal: AuthPrincipal;
    chatId: string;
    agentId: string;
    memoryScope: LedgerlyAiMemoryScope;
    projectId?: string | null;
    userMessageId: string;
    assistantMessageId: string;
    userText: string;
    assistantText: string;
    correlationId: string;
  }) {
    if (input.memoryScope === "chat") return null;
    let scopeType: LedgerlyAiMemoryScope = input.memoryScope;
    let scopeId: string;
    let fallbackReason: string | null = null;
    if (scopeType === "user") {
      scopeId = input.principal.userId;
    } else if (scopeType === "agent") {
      scopeId = input.agentId;
    } else if (scopeType === "organization") {
      if (isAdmin(input.principal)) scopeId = input.principal.organizationId;
      else { scopeType = "agent"; scopeId = input.agentId; fallbackReason = "organization-memory-requires-admin"; }
    } else if (scopeType === "project") {
      const projectId = input.projectId?.trim();
      if (projectId && (hasScope(input.principal,"work:read") || hasScope(input.principal,"work:write"))) {
        const project = await this.db.query(
          "SELECT 1 FROM work_projects WHERE id=$1 AND organization_id=$2 LIMIT 1",
          [projectId,input.principal.organizationId],
        );
        if (project.rowCount) scopeId = projectId;
        else { scopeType = "agent"; scopeId = input.agentId; fallbackReason = "project-not-found"; }
      } else {
        scopeType = "agent"; scopeId = input.agentId; fallbackReason = "project-context-unavailable";
      }
    } else {
      scopeType = "agent"; scopeId = input.agentId; fallbackReason = "unsupported-custom-memory-scope";
    }
    const content = redactLedgerlyAiText(
      `User: ${input.userText.slice(0,4000)}\n${input.assistantText.slice(0,6000)}`,
    );
    const id = createId("laimem");
    const result = await this.db.query<MemoryRow>(
      `INSERT INTO lai_memories(
        id,organization_id,scope_type,scope_id,memory_kind,title,content,importance,confidence,
        source_type,source_id,status,metadata_json,created_by,updated_by
      ) VALUES($1,$2,$3,$4,'summary','Custom employee conversation',$5,0.45,1,
               'custom_agent_turn',$6,'active',$7::jsonb,$8,$8)
       RETURNING ${selectColumns}`,
      [
        id,input.principal.organizationId,scopeType,scopeId,content,input.assistantMessageId,
        JSON.stringify({
          agentId:input.agentId,chatId:input.chatId,userMessageId:input.userMessageId,
          assistantMessageId:input.assistantMessageId,configuredScope:input.memoryScope,fallbackReason,
        }),input.principal.userId,
      ],
    );
    const row = result.rows[0];
    if (!row) return null;
    const memory = mapMemory(row);
    await this.audit(this.db,{
      organizationId:input.principal.organizationId,memoryId:memory.id,actorType:"system",actorId:"ledgerly-ai",
      action:"created",scopeType:memory.scopeType,scopeId:memory.scopeId,correlationId:input.correlationId,
      after:{id:memory.id,kind:memory.kind,sourceType:memory.sourceType},
      metadata:{automatic:true,customAgent:true,agentId:input.agentId,fallbackReason},
    });
    return memory;
  }
  private async retrievalScopeKeys(input: {
    principal: AuthPrincipal;
    chatId: string;
    agentId?: string | null;
    projectId?: string | null;
  }) {
    await this.chats.getChat(input.principal, input.chatId);
    const keys = [
      `user:${input.principal.userId}`,
      `chat:${input.chatId}`,
      `organization:${input.principal.organizationId}`,
    ];
    if (input.agentId) {
      const agent = await this.db.query(
        "SELECT 1 FROM lai_agents WHERE id=$1 AND organization_id=$2 AND status IN ('testing','active')",
        [input.agentId, input.principal.organizationId],
      );
      if (agent.rowCount) keys.push(`agent:${input.agentId}`);
    }
    if (input.projectId && (hasScope(input.principal, "work:read") || hasScope(input.principal, "work:write"))) {
      const project = await this.db.query(
        "SELECT 1 FROM work_projects WHERE id=$1 AND organization_id=$2",
        [input.projectId, input.principal.organizationId],
      );
      if (project.rowCount) keys.push(`project:${input.projectId}`);
    }
    return keys;
  }

  async retrieve(input: {
    principal: AuthPrincipal;
    chatId: string;
    query: string;
    agentId?: string | null;
    projectId?: string | null;
    correlationId?: string;
    limit?: number;
  }) {
    await this.expireDue(input.principal.organizationId);
    const scopeKeys = await this.retrievalScopeKeys(input);
    const query = input.query.trim().slice(0, 1500);
    const limit = Math.min(Math.max(input.limit ?? this.config.LEDGERLY_AI_MEMORY_RETRIEVAL_LIMIT, 1), 30);
    const result = await this.db.query<MemoryRow>(
      `SELECT ${selectColumns},
        (
          CASE WHEN $5='' THEN 0
               ELSE ts_rank_cd(
                 to_tsvector('simple',COALESCE(title,'') || ' ' || content),
                 plainto_tsquery('simple',$5)
               ) * 4 END
          + importance * 1.5
          + confidence * 0.8
          + CASE WHEN pinned THEN 1.5 ELSE 0 END
          + 1.0 / (1.0 + GREATEST(0,EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-updated_at))/86400.0))
        ) AS relevance
       FROM lai_memories
       WHERE organization_id=$1
         AND status='active'
         AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)
         AND (scope_type || ':' || scope_id)=ANY($2::text[])
         AND ($3::boolean OR required_scope IS NULL OR required_scope=ANY($4::text[]))
       ORDER BY relevance DESC,updated_at DESC
       LIMIT $6`,
      [
        input.principal.organizationId,
        scopeKeys,
        isAdmin(input.principal),
        input.principal.scopes,
        query,
        limit,
      ],
    );
    const memories = result.rows.map(mapMemory);
    if (memories.length) {
      await this.db.query(
        `UPDATE lai_memories SET last_used_at=CURRENT_TIMESTAMP,use_count=use_count+1
          WHERE organization_id=$1 AND id=ANY($2::text[])`,
        [input.principal.organizationId, memories.map((memory) => memory.id)],
      );
      await this.audit(this.db, {
        organizationId: input.principal.organizationId,
        actorType: "user",
        actorId: input.principal.userId,
        action: "retrieved",
        correlationId: input.correlationId,
        metadata: { memoryIds: memories.map((memory) => memory.id), queryLength: query.length, scopeKeys },
      });
    }
    return memories;
  }

  formatForContext(memories: LedgerlyAiMemoryRecord[]) {
    let remaining = this.config.LEDGERLY_AI_MEMORY_CONTEXT_CHARS;
    const blocks: string[] = [];
    for (const memory of memories) {
      if (remaining <= 0) break;
      const source = [memory.sourceType, memory.sourceId].filter(Boolean).join(":");
      const header = `[${memory.kind}; scope=${memory.scopeType}; confidence=${memory.confidence.toFixed(2)}; source=${source || "unknown"}]`;
      const content = memory.content.slice(0, Math.max(0, remaining - header.length - 2));
      if (!content) break;
      blocks.push(`${header}\n${content}`);
      remaining -= header.length + content.length + 2;
    }
    return blocks.join("\n\n");
  }

  async adminList(principal: AuthPrincipal, input: {
    scopeType?: LedgerlyAiMemoryScope;
    status?: "active" | "expired" | "deleted";
    query?: string;
    limit?: number;
  }) {
    if (!isAdmin(principal) && !principal.scopes.includes("admin:read")) {
      throw new AppError(403, "FORBIDDEN", "Memory inspection requires administrative permission.");
    }
    await this.expireDue(principal.organizationId);
    const query = input.query?.trim().slice(0, 1500) ?? "";
    const result = await this.db.query<MemoryRow>(
      `SELECT ${selectColumns}
         FROM lai_memories
        WHERE organization_id=$1
          AND ($2::text IS NULL OR scope_type=$2)
          AND ($3::text IS NULL OR status=$3)
          AND ($4='' OR to_tsvector('simple',COALESCE(title,'') || ' ' || content) @@ plainto_tsquery('simple',$4))
        ORDER BY pinned DESC,updated_at DESC
        LIMIT $5`,
      [principal.organizationId, input.scopeType ?? null, input.status ?? null, query, Math.min(input.limit ?? 200, 500)],
    );
    return result.rows.map(mapMemory);
  }

  async adminAudit(principal: AuthPrincipal, memoryId?: string, limit = 200) {
    if (!isAdmin(principal) && !principal.scopes.includes("admin:read")) {
      throw new AppError(403, "FORBIDDEN", "Memory audit access requires administrative permission.");
    }
    const result = await this.db.query(
      `SELECT id,memory_id AS "memoryId",actor_type AS "actorType",actor_id AS "actorId",
              action,scope_type AS "scopeType",scope_id AS "scopeId",correlation_id AS "correlationId",
              reason,before_json AS "before",after_json AS "after",metadata_json AS metadata,
              created_at AS "createdAt"
         FROM lai_memory_audit
        WHERE organization_id=$1 AND ($2::text IS NULL OR memory_id=$2)
        ORDER BY created_at DESC
        LIMIT $3`,
      [principal.organizationId, memoryId ?? null, Math.min(Math.max(limit, 1), 500)],
    );
    return result.rows;
  }
}
