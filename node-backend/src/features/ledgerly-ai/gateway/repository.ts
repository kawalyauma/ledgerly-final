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

export type LedgerlyAiChatFileRow={
  id:string;chatId:string|null;messageId:string|null;direction:"input"|"output";
  objectKey:string;filename:string;mimeType:string;sizeBytes:number;createdAt:string;
};

export type LedgerlyAiSchoolContext = {
  organization: {
    name: string;
    legalName: string | null;
    baseCurrency: string;
    timezone: string;
    address: Record<string, unknown>;
    branding: Record<string, unknown>;
  };
  profile: Record<string, unknown> | null;
  academicYear: Record<string, unknown> | null;
  term: Record<string, unknown> | null;
  mainBranch: Record<string, unknown> | null;
  documentSettings: Array<{ group: string; key: string; value: unknown }>;
};

export type LedgerlyAiResumableJob = {
  id: string;
  chatId: string;
  status: "failed" | "cancelled";
  provider: "claude-code" | "codex" | null;
  sessionId: string | null;
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

  async getSchoolContext(principal: AuthPrincipal): Promise<LedgerlyAiSchoolContext> {
    const [school, academicYear, term, mainBranch, settings] = await Promise.all([
      this.db.query<Record<string, unknown>>(
        `SELECT o.name,o.legal_name AS "legalName",o.base_currency AS "baseCurrency",o.timezone,
                o.address,o.branding AS "organizationBranding",
                sp.school_code AS "schoolCode",sp.registration_number AS "registrationNumber",sp.motto,
                sp.school_type AS "schoolType",sp.ownership_type AS "ownershipType",
                sp.education_level AS "educationLevel",sp.curriculum,sp.phone_numbers AS "phoneNumbers",
                sp.email_addresses AS "emailAddresses",sp.website,sp.physical_address AS "physicalAddress",
                sp.postal_address AS "postalAddress",sp.country,sp.district_region AS "districtRegion",
                sp.location_text AS "locationText",sp.head_teacher_name AS "headTeacherName",
                sp.head_teacher_phone AS "headTeacherPhone",sp.head_teacher_email AS "headTeacherEmail",
                sp.language,sp.date_format AS "dateFormat",sp.default_currency AS "defaultCurrency",
                sp.branding AS "schoolBranding",sp.system_preferences AS "systemPreferences",
                (sp.organization_id IS NOT NULL) AS "hasProfile"
           FROM organizations o
           LEFT JOIN school_profiles sp ON sp.organization_id=o.id
          WHERE o.id=$1`,
        [principal.organizationId],
      ),
      this.db.query<Record<string, unknown>>(
        `SELECT id,code,name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",status
           FROM school_academic_years
          WHERE organization_id=$1
          ORDER BY is_current DESC,(status='active') DESC,starts_on DESC LIMIT 1`,
        [principal.organizationId],
      ),
      this.db.query<Record<string, unknown>>(
        `SELECT t.id,t.code,t.name,t.sequence_no AS "sequenceNo",t.starts_on::text AS "startsOn",
                t.ends_on::text AS "endsOn",t.status,y.name AS "academicYearName"
           FROM school_terms t
           JOIN school_academic_years y ON y.id=t.academic_year_id AND y.organization_id=t.organization_id
          WHERE t.organization_id=$1
          ORDER BY t.is_current DESC,(t.status='active') DESC,t.starts_on DESC LIMIT 1`,
        [principal.organizationId],
      ),
      this.db.query<Record<string, unknown>>(
        `SELECT id,code,name,registration_number AS "registrationNumber",phone,email,
                physical_address AS "physicalAddress",postal_address AS "postalAddress",
                district_region AS "districtRegion",location_text AS "locationText",
                principal_name AS "principalName"
           FROM school_branches
          WHERE organization_id=$1 AND active=true
          ORDER BY is_main DESC,name LIMIT 1`,
        [principal.organizationId],
      ),
      this.db.query<Record<string, unknown>>(
        `SELECT setting_group AS "group",setting_key AS "key",value_json AS value
           FROM school_settings
          WHERE organization_id=$1
            AND lower(setting_group) IN ('branding','documents','document','school','letterhead')
          ORDER BY setting_group,setting_key LIMIT 50`,
        [principal.organizationId],
      ),
    ]);
    const row = school.rows[0];
    if (!row) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "The active school was not found.");
    const {
      hasProfile, name, legalName, baseCurrency, timezone, address, organizationBranding,
      ...profileFields
    } = row;
    const profile = hasProfile
      ? Object.fromEntries(Object.entries(profileFields).filter(([, value]) => value !== null && value !== undefined))
      : null;
    return {
      organization: {
        name: String(name),
        legalName: legalName ? String(legalName) : null,
        baseCurrency: String(baseCurrency),
        timezone: String(timezone),
        address: (address && typeof address === "object" ? address : {}) as Record<string, unknown>,
        branding: (organizationBranding && typeof organizationBranding === "object" ? organizationBranding : {}) as Record<string, unknown>,
      },
      profile,
      academicYear: academicYear.rows[0] ?? null,
      term: term.rows[0] ?? null,
      mainBranch: mainBranch.rows[0] ?? null,
      documentSettings: settings.rows.map((item) => ({ group: String(item.group), key: String(item.key), value: item.value })),
    };
  }

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

  async createChatFile(input:{principal:AuthPrincipal;id:string;chatId?:string|null;messageId?:string|null;direction:"input"|"output";objectKey:string;filename:string;mimeType:string;sizeBytes:number}){
    const result=await this.db.query<Record<string,unknown>>(
      `INSERT INTO lai_chat_files(id,organization_id,chat_id,message_id,direction,object_key,filename,mime_type,size_bytes,uploaded_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id,chat_id AS "chatId",message_id AS "messageId",direction,object_key AS "objectKey",filename,mime_type AS "mimeType",size_bytes::float8 AS "sizeBytes",created_at AS "createdAt"`,
      [input.id,input.principal.organizationId,input.chatId??null,input.messageId??null,input.direction,input.objectKey,input.filename,input.mimeType,input.sizeBytes,input.principal.userId],
    );
    return result.rows[0] as unknown as LedgerlyAiChatFileRow;
  }

  async getMyChatFiles(principal:AuthPrincipal,ids:string[]){
    if(!ids.length)return[];
    const result=await this.db.query<Record<string,unknown>>(
      `SELECT id,chat_id AS "chatId",message_id AS "messageId",direction,object_key AS "objectKey",filename,mime_type AS "mimeType",size_bytes::float8 AS "sizeBytes",created_at AS "createdAt"
         FROM lai_chat_files WHERE organization_id=$1 AND uploaded_by=$2 AND id=ANY($3::text[])`,
      [principal.organizationId,principal.userId,ids],
    );
    if(result.rows.length!==new Set(ids).size)throw new AppError(404,"LEDGERLY_AI_FILE_NOT_FOUND","One or more chat files were not found.");
    return result.rows as unknown as LedgerlyAiChatFileRow[];
  }

  async getMyChatFile(principal:AuthPrincipal,id:string){
    const rows=await this.getMyChatFiles(principal,[id]);return rows[0]!;
  }

  async bindChatFiles(principal:AuthPrincipal,ids:string[],chatId:string){
    if(!ids.length)return;
    await this.getMyChat(principal,chatId);
    await this.db.query(
      `UPDATE lai_chat_files SET chat_id=$1 WHERE organization_id=$2 AND uploaded_by=$3 AND id=ANY($4::text[]) AND direction='input'`,
      [chatId,principal.organizationId,principal.userId,ids],
    );
  }

  async bindOutputFiles(principal:AuthPrincipal,ids:string[],messageId:string){
    if(!ids.length)return;
    await this.db.query(
      `UPDATE lai_chat_files SET message_id=$1 WHERE organization_id=$2 AND uploaded_by=$3 AND id=ANY($4::text[]) AND direction='output'`,
      [messageId,principal.organizationId,principal.userId,ids],
    );
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
    // An owner may soft-delete the active chat while an AI operation is still
    // running (for example, "delete all chats"). Let in-flight assistant/tool
    // output finish on that auditable row; new user turns still require an
    // active, visible chat.
    await this.getChat(input.principal, input.chatId, input.role !== "user");
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

  async checkpointJob(
    organizationId: string,
    id: string,
    checkpoint: { provider: "claude-code" | "codex"; sessionId: string },
  ) {
    await this.db.query(
      `UPDATE lai_jobs
          SET result_json=COALESCE(result_json,'{}'::jsonb) || jsonb_build_object('checkpoint',$1::jsonb),
              updated_at=CURRENT_TIMESTAMP
        WHERE id=$2 AND organization_id=$3 AND status IN ('queued','running')`,
      [JSON.stringify(checkpoint), id, organizationId],
    );
  }

  async getResumableJob(principal: AuthPrincipal, chatId: string, id: string): Promise<LedgerlyAiResumableJob> {
    const result=await this.db.query<Record<string,unknown>>(
      `SELECT id,chat_id AS "chatId",status,
              result_json #>> '{checkpoint,provider}' AS provider,
              result_json #>> '{checkpoint,sessionId}' AS "sessionId"
         FROM lai_jobs
        WHERE id=$1 AND organization_id=$2 AND created_by=$3 AND chat_id=$4
          AND status IN ('failed','cancelled')
          AND NOT (COALESCE(result_json,'{}'::jsonb) ? 'resumedByJobId')
        LIMIT 1`,
      [id,principal.organizationId,principal.userId,chatId],
    );
    const row=result.rows[0];
    if(!row)throw new AppError(409,"LEDGERLY_AI_JOB_NOT_RESUMABLE","This interrupted request is no longer available to resume.");
    const provider=row.provider==="codex"||row.provider==="claude-code"?row.provider:null;
    return {id:String(row.id),chatId:String(row.chatId),status:row.status as "failed"|"cancelled",provider,sessionId:row.sessionId?String(row.sessionId):null};
  }

  async markJobResumed(organizationId:string,chatId:string,id:string,resumedByJobId:string){
    await Promise.all([
      this.db.query(
        `UPDATE lai_jobs SET result_json=COALESCE(result_json,'{}'::jsonb) || jsonb_build_object('resumedByJobId',$1::text),updated_at=CURRENT_TIMESTAMP
          WHERE id=$2 AND organization_id=$3 AND chat_id=$4`,
        [resumedByJobId,id,organizationId,chatId],
      ),
      this.db.query(
        `UPDATE lai_messages
            SET metadata_json=metadata_json || jsonb_build_object('resumable',false,'resumedByJobId',$1::text)
          WHERE organization_id=$2 AND chat_id=$3 AND metadata_json->>'kind'='failure' AND metadata_json->>'jobId'=$4`,
        [resumedByJobId,organizationId,chatId,id],
      ),
    ]);
  }

  async recoverInterruptedJobs() {
    const jobs=await this.db.query<Record<string,unknown>>(
      `UPDATE lai_jobs
          SET status='failed',error_text='The Ledgerly AI service restarted before this request finished.',
              completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE status IN ('queued','running')
           OR (
             status='failed'
             AND error_text='The Ledgerly AI service restarted before this request finished.'
             AND NOT EXISTS(
               SELECT 1 FROM lai_messages m
                WHERE m.organization_id=lai_jobs.organization_id AND m.chat_id=lai_jobs.chat_id
                  AND m.metadata_json->>'kind'='failure' AND m.metadata_json->>'jobId'=lai_jobs.id
             )
           )
        RETURNING id,organization_id AS "organizationId",chat_id AS "chatId",
                  correlation_id AS "correlationId",result_json AS result`,
    );
    for(const row of jobs.rows){
      const result=(row.result&&typeof row.result==="object"?row.result:{}) as Record<string,unknown>;
      const checkpoint=(result.checkpoint&&typeof result.checkpoint==="object"?result.checkpoint:{}) as Record<string,unknown>;
      const exact=typeof checkpoint.sessionId==="string"&&Boolean(checkpoint.sessionId);
      await this.db.query(
        `INSERT INTO lai_messages(id,organization_id,chat_id,role,content,user_id,agent_id,correlation_id,metadata_json)
         SELECT $1::text,$2::text,$3::text,'assistant',$4::text,NULL,NULL,$5::text,$6::jsonb
          WHERE $3::text IS NOT NULL
            AND EXISTS(SELECT 1 FROM lai_chats WHERE id=$3::text AND organization_id=$2::text)
            AND NOT EXISTS(
              SELECT 1 FROM lai_messages
               WHERE organization_id=$2::text AND chat_id=$3::text
                 AND metadata_json->>'kind'='failure' AND metadata_json->>'jobId'=$7::text
            )`,
        [createId("laim"),row.organizationId,row.chatId,
          "Ledgerly AI was interrupted by a service restart before it finished. Your conversation has been saved. Select Resume to continue from the last checkpoint.",
          row.correlationId,JSON.stringify({kind:"failure",jobId:String(row.id),resumable:true,resumeMode:exact?"provider":"context",interrupted:true,employeeName:"Ledgerly AI"}),row.id],
      );
      if(row.chatId)await this.db.query("UPDATE lai_chats SET last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2",[row.chatId,row.organizationId]);
      await this.db.query(
        `UPDATE lai_provider_executions SET status='failed',error_text=COALESCE(error_text,'Service restarted before execution finished.'),completed_at=CURRENT_TIMESTAMP
          WHERE job_id=$1 AND organization_id=$2 AND status='running'`,
        [row.id,row.organizationId],
      );
    }
    return jobs.rowCount??0;
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
