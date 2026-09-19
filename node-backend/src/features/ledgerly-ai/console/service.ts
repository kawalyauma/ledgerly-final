import type { AuthPrincipal } from "../../../http/types.js";
import { AppError } from "../../../http/errors.js";
import type { Runtime } from "../../../runtime.js";
import type { LedgerlyAiFoundationService } from "../service.js";

function requireAdmin(principal:AuthPrincipal){
  if(principal.role!=="owner"&&principal.role!=="admin"&&!principal.scopes.includes("admin:read")){
    throw new AppError(403,"FORBIDDEN","Ledgerly AI console requires administrative permission.");
  }
}
function bounded(limit:number,max=500){return Math.min(Math.max(limit,1),max);}

export class LedgerlyAiConsoleService{
  constructor(private readonly runtime:Runtime,private readonly ai:LedgerlyAiFoundationService){}

  async overview(principal:AuthPrincipal){
    requireAdmin(principal);
    const org=principal.organizationId;
    const [
      employees,jobs,incidents,approvals,chats,memories,toolCalls,providerExecutions,customAgents,git,
    ]=await Promise.all([
      this.runtime.db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER(WHERE status='active')::int AS active,
                COUNT(*) FILTER(WHERE status='paused')::int AS paused,
                COUNT(*) FILTER(WHERE kind='custom')::int AS custom
           FROM lai_agents WHERE organization_id=$1`,[org]),
      this.runtime.db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER(WHERE status='queued')::int AS queued,
                COUNT(*) FILTER(WHERE status='running')::int AS running,
                COUNT(*) FILTER(WHERE status='waiting_approval')::int AS "waitingApproval",
                COUNT(*) FILTER(WHERE status='failed' AND created_at>CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "failed24h"
           FROM lai_jobs WHERE organization_id=$1`,[org]),
      this.runtime.db.query(
        `SELECT COUNT(*) FILTER(WHERE status NOT IN ('closed','failed'))::int AS open,
                COUNT(*) FILTER(WHERE status NOT IN ('closed','failed') AND severity='critical')::int AS critical,
                COUNT(*) FILTER(WHERE status NOT IN ('closed','failed') AND severity='high')::int AS high
           FROM lai_incidents WHERE organization_id=$1`,[org]),
      this.runtime.db.query(
        `SELECT COUNT(*) FILTER(WHERE status='pending')::int AS pending,
                COUNT(*) FILTER(WHERE status='pending' AND risk_level='critical')::int AS critical
           FROM lai_approvals WHERE organization_id=$1`,[org]),
      this.runtime.db.query(
        `SELECT COUNT(*) FILTER(WHERE status='active')::int AS active,
                COUNT(*) FILTER(WHERE created_at>CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "created24h"
           FROM lai_chats WHERE organization_id=$1 AND status<>'deleted'`,[org]),
      this.runtime.db.query(
        `SELECT COUNT(*) FILTER(WHERE status='active')::int AS active,
                COUNT(*) FILTER(WHERE pinned=TRUE AND status='active')::int AS pinned
           FROM lai_memories WHERE organization_id=$1`,[org]),
      this.runtime.db.query(
        `SELECT COUNT(*) FILTER(WHERE created_at>CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "calls24h",
                COUNT(*) FILTER(WHERE status='failed' AND created_at>CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "failed24h"
           FROM lai_tool_calls WHERE organization_id=$1`,[org]),
      this.runtime.db.query(
        `SELECT COUNT(*) FILTER(WHERE created_at>CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "runs24h",
                COUNT(*) FILTER(WHERE status='failed' AND created_at>CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "failed24h",
                COUNT(*) FILTER(WHERE status='running')::int AS running
           FROM lai_provider_executions WHERE organization_id=$1`,[org]),
      this.runtime.db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER(WHERE status='active')::int AS active
           FROM lai_agents WHERE organization_id=$1 AND kind='custom'`,[org]),
      this.runtime.db.query(
        `SELECT COUNT(*) FILTER(WHERE status='pr_open')::int AS "openPrs",
                COUNT(*) FILTER(WHERE status='conflict')::int AS conflicts
           FROM lai_git_workspaces WHERE organization_id=$1`,[org]),
    ]);
    const [health,monitoring,controls]=await Promise.all([
      this.ai.health().catch(()=>null),
      this.ai.monitoring.overview(principal).catch(()=>null),
      this.ai.policy.listControls(principal).catch(()=>[]),
    ]);
    return{
      health,
      monitoring,
      controls,
      employees:employees.rows[0]??{},
      jobs:jobs.rows[0]??{},
      incidents:incidents.rows[0]??{},
      approvals:approvals.rows[0]??{},
      chats:chats.rows[0]??{},
      memories:memories.rows[0]??{},
      tools:toolCalls.rows[0]??{},
      providers:providerExecutions.rows[0]??{},
      customAgents:customAgents.rows[0]??{},
      git:git.rows[0]??{},
      generatedAt:new Date().toISOString(),
    };
  }

  async jobs(principal:AuthPrincipal,input:{status?:string;limit?:number}={}){
    requireAdmin(principal);
    const result=await this.runtime.db.query(
      `SELECT j.id,j.kind,j.status,j.risk_level AS "riskLevel",j.correlation_id AS "correlationId",
              j.agent_id AS "agentId",a.display_name AS "agentName",j.chat_id AS "chatId",
              j.created_by AS "createdBy",j.error_text AS error,j.started_at AS "startedAt",
              j.completed_at AS "completedAt",j.created_at AS "createdAt",j.updated_at AS "updatedAt",
              CASE WHEN j.started_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (COALESCE(j.completed_at,CURRENT_TIMESTAMP)-j.started_at))*1000
                ELSE NULL END AS "durationMs"
         FROM lai_jobs j
         LEFT JOIN lai_agents a ON a.id=j.agent_id AND a.organization_id=j.organization_id
        WHERE j.organization_id=$1 AND ($2::text IS NULL OR j.status=$2)
        ORDER BY j.created_at DESC LIMIT $3`,
      [principal.organizationId,input.status??null,bounded(input.limit??150)],
    );
    return result.rows;
  }

  async activity(principal:AuthPrincipal,limit=200){
    requireAdmin(principal);
    const org=principal.organizationId;
    const result=await this.runtime.db.query(
      `SELECT * FROM (
        SELECT created_at AS "createdAt",'job'::text AS type,id AS "entityId",
               status AS state,kind AS title,
               COALESCE(error_text,'') AS detail,agent_id AS "agentId",correlation_id AS "correlationId"
          FROM lai_jobs WHERE organization_id=$1
        UNION ALL
        SELECT created_at,'tool',id,status,tool_name,
               COALESCE(error_text,''),agent_id,correlation_id
          FROM lai_tool_calls WHERE organization_id=$1
        UNION ALL
        SELECT created_at,'audit',id,action,entity_type,
               COALESCE(metadata_json::text,''),NULL,correlation_id
          FROM lai_audit_events WHERE organization_id=$1
        UNION ALL
        SELECT created_at,'privileged',id,action,entity_type,
               COALESCE(metadata_json::text,''),NULL,correlation_id
          FROM lai_privileged_audit WHERE organization_id=$1
        UNION ALL
        SELECT detected_at,'incident',id,status,title,
               severity,assigned_agent_id,COALESCE(correlation_id,id)
          FROM lai_incidents WHERE organization_id=$1
      ) x ORDER BY "createdAt" DESC LIMIT $2`,
      [org,bounded(limit,500)],
    );
    return result.rows;
  }

  async deployments(principal:AuthPrincipal,limit=150){
    requireAdmin(principal);
    const result=await this.runtime.db.query(
      `SELECT d.id,d.incident_id AS "incidentId",i.title AS "incidentTitle",
              d.environment,d.status,d.previous_ref AS "previousRef",d.deployed_ref AS "deployedRef",
              d.project_key AS "projectKey",d.image_tag AS "imageTag",
              d.created_by AS "createdBy",d.created_at AS "createdAt",
              d.deployed_at AS "deployedAt",d.verified_at AS "verifiedAt",
              d.rolled_back_at AS "rolledBackAt",d.completed_at AS "completedAt",
              d.smoke_json AS smoke,d.rollback_json AS rollback
         FROM lai_incident_deployments d
         JOIN lai_incidents i ON i.id=d.incident_id
        WHERE i.organization_id=$1
        ORDER BY d.created_at DESC LIMIT $2`,
      [principal.organizationId,bounded(limit,300)],
    );
    return result.rows;
  }

  async audit(principal:AuthPrincipal,limit=250){
    requireAdmin(principal);
    const result=await this.runtime.db.query(
      `SELECT * FROM (
        SELECT id,created_at AS "createdAt",actor_type AS "actorType",actor_id AS "actorId",
               action,entity_type AS "entityType",entity_id AS "entityId",
               correlation_id AS "correlationId",NULL::text AS "riskLevel",metadata_json AS metadata,
               'general'::text AS source
          FROM lai_audit_events WHERE organization_id=$1
        UNION ALL
        SELECT id,created_at,actor_type,actor_id,action,entity_type,entity_id,correlation_id,
               risk_level,metadata_json,'privileged'
          FROM lai_privileged_audit WHERE organization_id=$1
      ) x ORDER BY "createdAt" DESC LIMIT $2`,
      [principal.organizationId,bounded(limit,500)],
    );
    return result.rows;
  }

  async usage(principal:AuthPrincipal,days=7){
    requireAdmin(principal);
    const boundedDays=Math.min(Math.max(days,1),90);
    const org=principal.organizationId;
    const [agents,tools,providers,daily]=await Promise.all([
      this.runtime.db.query(
        `SELECT COALESCE(a.display_name,'Unassigned') AS label,j.agent_id AS "agentId",
                COUNT(*)::int AS jobs,
                COUNT(*) FILTER(WHERE j.status='completed')::int AS completed,
                COUNT(*) FILTER(WHERE j.status='failed')::int AS failed,
                AVG(EXTRACT(EPOCH FROM (j.completed_at-j.started_at))*1000)
                  FILTER(WHERE j.started_at IS NOT NULL AND j.completed_at IS NOT NULL) AS "averageDurationMs"
           FROM lai_jobs j LEFT JOIN lai_agents a ON a.id=j.agent_id AND a.organization_id=j.organization_id
          WHERE j.organization_id=$1 AND j.created_at>CURRENT_TIMESTAMP-($2::int*INTERVAL '1 day')
          GROUP BY j.agent_id,a.display_name ORDER BY jobs DESC`,
        [org,boundedDays]),
      this.runtime.db.query(
        `SELECT tool_name AS label,COUNT(*)::int AS calls,
                COUNT(*) FILTER(WHERE status='succeeded')::int AS succeeded,
                COUNT(*) FILTER(WHERE status='failed')::int AS failed,
                AVG(duration_ms) FILTER(WHERE duration_ms IS NOT NULL) AS "averageDurationMs"
           FROM lai_tool_calls
          WHERE organization_id=$1 AND created_at>CURRENT_TIMESTAMP-($2::int*INTERVAL '1 day')
          GROUP BY tool_name ORDER BY calls DESC LIMIT 50`,[org,boundedDays]),
      this.runtime.db.query(
        `SELECT provider_internal AS label,COUNT(*)::int AS executions,
                COUNT(*) FILTER(WHERE status='succeeded')::int AS succeeded,
                COUNT(*) FILTER(WHERE status='failed')::int AS failed,
                AVG(EXTRACT(EPOCH FROM (completed_at-started_at))*1000)
                  FILTER(WHERE started_at IS NOT NULL AND completed_at IS NOT NULL) AS "averageDurationMs"
           FROM lai_provider_executions
          WHERE organization_id=$1 AND created_at>CURRENT_TIMESTAMP-($2::int*INTERVAL '1 day')
          GROUP BY provider_internal ORDER BY executions DESC`,[org,boundedDays]),
      this.runtime.db.query(
        `SELECT date_trunc('day',created_at) AS day,COUNT(*)::int AS jobs,
                COUNT(*) FILTER(WHERE status='failed')::int AS failed
           FROM lai_jobs
          WHERE organization_id=$1 AND created_at>CURRENT_TIMESTAMP-($2::int*INTERVAL '1 day')
          GROUP BY 1 ORDER BY 1`,[org,boundedDays]),
    ]);
    return{
      days:boundedDays,
      agents:agents.rows,
      tools:tools.rows,
      providers:providers.rows,
      daily:daily.rows,
      providerBreakdownRestricted:true,
      generatedAt:new Date().toISOString(),
    };
  }
}
