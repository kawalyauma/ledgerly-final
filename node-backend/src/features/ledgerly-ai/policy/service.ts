import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import type { Runtime } from "../../../runtime.js";
import { createId } from "../../core-identity/security.js";
import type { LedgerlyAiEmployee } from "../employees/types.js";
import type { LedgerlyAiRiskLevel } from "../types.js";
import type { LedgerlyAiToolDefinition } from "../tools/types.js";

export type LedgerlyAiPolicyEffect="auto"|"single"|"two_step"|"deny";
export type LedgerlyAiControlState="active"|"paused"|"stopped";
export type LedgerlyAiPolicyDecision={
  effect:LedgerlyAiPolicyEffect;
  approvalMode:"single"|"two_step"|null;
  requiredApprovals:number;
  reviewerRole:"admin"|"owner"|null;
  riskLevel:LedgerlyAiRiskLevel;
  reason:string;
  ruleId:string|null;
};

type PolicyRuleRow={
  id:string;name:string;actionPattern:string;agentKey:string|null;minRisk:LedgerlyAiRiskLevel|null;
  mutatingOnly:boolean;productionOnly:boolean;effect:LedgerlyAiPolicyEffect;
  reviewerRole:"admin"|"owner"|null;priority:number;
};

const RISK_ORDER:Record<LedgerlyAiRiskLevel,number>={low:1,medium:2,high:3,critical:4};

function isAdmin(principal:AuthPrincipal){
  return principal.role==="owner"||principal.role==="admin";
}
function actionMatches(pattern:string,action:string){
  if(pattern==="*")return true;
  if(pattern.endsWith("*"))return action.startsWith(pattern.slice(0,-1));
  return pattern===action;
}
function roleSatisfies(principal:AuthPrincipal,role:"admin"|"owner"|null){
  if(!role)return isAdmin(principal);
  if(role==="owner")return principal.role==="owner";
  return principal.role==="owner"||principal.role==="admin";
}

export class LedgerlyAiPolicyService{
  constructor(private readonly runtime:Runtime){}

  async privilegedAudit(input:{
    organizationId:string;actorType:"user"|"agent"|"system";actorId:string;action:string;
    entityType:string;entityId?:string|null;correlationId:string;riskLevel?:LedgerlyAiRiskLevel|null;
    metadata?:Record<string,unknown>;
  }){
    await this.runtime.db.query(
      `INSERT INTO lai_privileged_audit(
        id,organization_id,actor_type,actor_id,action,entity_type,entity_id,correlation_id,risk_level,metadata_json
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        createId("laipa"),input.organizationId,input.actorType,input.actorId,input.action,
        input.entityType,input.entityId??null,input.correlationId,input.riskLevel??null,
        JSON.stringify(input.metadata??{}),
      ],
    );
  }

  private async controlsFor(organizationId:string,agentId?:string|null){
    const result=await this.runtime.db.query<{scopeType:"organization"|"agent";scopeId:string;state:LedgerlyAiControlState;reason:string|null}>(
      `SELECT scope_type AS "scopeType",scope_id AS "scopeId",state,reason
         FROM lai_ai_controls
        WHERE organization_id=$1
          AND ((scope_type='organization' AND scope_id='')
            OR (scope_type='agent' AND scope_id=$2))`,
      [organizationId,agentId??""],
    );
    return result.rows;
  }

  async autonomyState(organizationId:string,agentId?:string|null){
    const controls=await this.controlsFor(organizationId,agentId);
    const organization=controls.find(row=>row.scopeType==="organization")??null;
    const agent=controls.find(row=>row.scopeType==="agent")??null;
    const blocking=organization?.state!=="active"&&organization?organization:
      agent?.state!=="active"&&agent?agent:null;
    return{
      allowed:!blocking,
      organization:organization??{scopeType:"organization" as const,scopeId:"",state:"active" as const,reason:null},
      agent:agent??null,
      blocking,
    };
  }

  async assertAutonomyAllowed(organizationId:string,agentId?:string|null){
    const state=await this.autonomyState(organizationId,agentId);
    if(!state.allowed){
      const code=state.blocking?.state==="stopped"?"LEDGERLY_AI_EMERGENCY_STOP":"LEDGERLY_AI_AUTONOMY_PAUSED";
      throw new AppError(409,code,state.blocking?.state==="stopped"
        ?"Ledgerly AI autonomous activity is emergency-stopped for this scope."
        :"Ledgerly AI autonomous activity is paused for this scope.",{
          scopeType:state.blocking?.scopeType,scopeId:state.blocking?.scopeId,reason:state.blocking?.reason,
        });
    }
    return state;
  }

  private async rules(organizationId:string){
    const result=await this.runtime.db.query<PolicyRuleRow>(
      `SELECT id,name,action_pattern AS "actionPattern",agent_key AS "agentKey",
              min_risk AS "minRisk",mutating_only AS "mutatingOnly",
              production_only AS "productionOnly",effect,reviewer_role AS "reviewerRole",priority
         FROM lai_policy_rules
        WHERE organization_id=$1 AND enabled=TRUE
        ORDER BY priority,id`,
      [organizationId],
    );
    return result.rows;
  }

  private defaultDecision(input:{
    riskLevel:LedgerlyAiRiskLevel;mutating:boolean;approvalRequired:boolean;
    production:boolean;destructive:boolean;
  }):LedgerlyAiPolicyDecision{
    if(input.production&&input.destructive){
      return{
        effect:"deny",approvalMode:null,requiredApprovals:0,reviewerRole:"owner",
        riskLevel:input.riskLevel,reason:"Destructive production actions are denied unless an explicit policy rule permits them.",ruleId:null,
      };
    }
    if(input.riskLevel==="critical"){
      return{
        effect:"two_step",approvalMode:"two_step",requiredApprovals:2,reviewerRole:"owner",
        riskLevel:input.riskLevel,reason:"Critical actions require two distinct owner approvals.",ruleId:null,
      };
    }
    if(input.riskLevel==="high"){
      return{
        effect:"single",approvalMode:"single",requiredApprovals:1,reviewerRole:"admin",
        riskLevel:input.riskLevel,reason:"High-risk actions require human approval.",ruleId:null,
      };
    }
    if(input.riskLevel==="medium"&&(input.mutating||input.approvalRequired)){
      return{
        effect:"single",approvalMode:"single",requiredApprovals:1,reviewerRole:"admin",
        riskLevel:input.riskLevel,reason:"Mutating or approval-marked medium-risk actions require human approval.",ruleId:null,
      };
    }
    if(input.approvalRequired){
      return{
        effect:"single",approvalMode:"single",requiredApprovals:1,reviewerRole:"admin",
        riskLevel:input.riskLevel,reason:"The action definition explicitly requires approval.",ruleId:null,
      };
    }
    return{
      effect:"auto",approvalMode:null,requiredApprovals:0,reviewerRole:null,
      riskLevel:input.riskLevel,reason:"The operation is explicitly low-impact/read-only under the default policy.",ruleId:null,
    };
  }

  async evaluate(input:{
    principal:AuthPrincipal;employee:LedgerlyAiEmployee|null;action:string;riskLevel:LedgerlyAiRiskLevel;
    mutating:boolean;approvalRequired?:boolean;production?:boolean;destructive?:boolean;
  }):Promise<LedgerlyAiPolicyDecision>{
    if(input.employee)await this.assertAutonomyAllowed(input.principal.organizationId,input.employee.id);
    const baseline=this.defaultDecision({
      riskLevel:input.riskLevel,mutating:input.mutating,approvalRequired:Boolean(input.approvalRequired),
      production:Boolean(input.production),destructive:Boolean(input.destructive),
    });
    const rules=await this.rules(input.principal.organizationId);
    const employeeKey=input.employee?.key??null;
    const matched=rules.find(rule=>{
      if(!actionMatches(rule.actionPattern,input.action))return false;
      if(rule.agentKey&&rule.agentKey!==employeeKey)return false;
      if(rule.minRisk&&RISK_ORDER[input.riskLevel]<RISK_ORDER[rule.minRisk])return false;
      if(rule.mutatingOnly&&!input.mutating)return false;
      if(rule.productionOnly&&!input.production)return false;
      return true;
    });
    if(!matched)return baseline;

    if(input.production&&input.destructive&&matched.effect==="auto"){
      return{
        effect:"single",approvalMode:"single",requiredApprovals:1,reviewerRole:"owner",
        riskLevel:input.riskLevel,reason:"Explicit production policy permits this destructive action, but owner approval remains mandatory.",
        ruleId:matched.id,
      };
    }
    if(matched.effect==="deny"){
      return{
        effect:"deny",approvalMode:null,requiredApprovals:0,reviewerRole:matched.reviewerRole,
        riskLevel:input.riskLevel,reason:`Denied by policy rule: ${matched.name}`,ruleId:matched.id,
      };
    }
    if(matched.effect==="two_step"){
      return{
        effect:"two_step",approvalMode:"two_step",requiredApprovals:2,reviewerRole:matched.reviewerRole??"owner",
        riskLevel:input.riskLevel,reason:`Two-step approval required by policy rule: ${matched.name}`,ruleId:matched.id,
      };
    }
    if(matched.effect==="single"){
      return{
        effect:"single",approvalMode:"single",requiredApprovals:1,reviewerRole:matched.reviewerRole??"admin",
        riskLevel:input.riskLevel,reason:`Human approval required by policy rule: ${matched.name}`,ruleId:matched.id,
      };
    }
    return{
      effect:"auto",approvalMode:null,requiredApprovals:0,reviewerRole:null,
      riskLevel:input.riskLevel,reason:`Auto-approved by explicit safe-operation policy rule: ${matched.name}`,ruleId:matched.id,
    };
  }

  evaluateTool(input:{principal:AuthPrincipal;employee:LedgerlyAiEmployee|null;tool:LedgerlyAiToolDefinition}){
    return this.evaluate({
      principal:input.principal,employee:input.employee,action:"tool."+input.tool.name,
      riskLevel:input.tool.riskLevel,mutating:input.tool.mutating,
      approvalRequired:input.tool.approvalRequired,
      production:Boolean(input.tool.productionAction),destructive:Boolean(input.tool.destructive),
    });
  }

  assertReviewer(principal:AuthPrincipal,reviewerRole:"admin"|"owner"|null){
    if(!roleSatisfies(principal,reviewerRole)){
      throw new AppError(403,"LEDGERLY_AI_APPROVER_ROLE_REQUIRED",
        reviewerRole==="owner"?"This approval requires an organization owner.":"This approval requires an administrator.",{
          reviewerRole,
        });
    }
  }

  async listControls(principal:AuthPrincipal){
    if(!isAdmin(principal)&&!principal.scopes.includes("admin:read"))throw new AppError(403,"FORBIDDEN","Policy controls require administrative permission.");
    const result=await this.runtime.db.query(
      `SELECT id,scope_type AS "scopeType",scope_id AS "scopeId",state,reason,
              updated_by AS "updatedBy",created_at AS "createdAt",updated_at AS "updatedAt"
         FROM lai_ai_controls WHERE organization_id=$1 ORDER BY scope_type,scope_id`,
      [principal.organizationId],
    );
    return result.rows;
  }

  async setControl(principal:AuthPrincipal,input:{
    scopeType:"organization"|"agent";scopeId?:string|null;state:LedgerlyAiControlState;reason?:string|null;
  }){
    if(!isAdmin(principal)&&!principal.scopes.includes("admin:write"))throw new AppError(403,"FORBIDDEN","Policy controls require administrative permission.");
    if(input.scopeType==="organization"&&input.state==="stopped"&&principal.role!=="owner"){
      throw new AppError(403,"FORBIDDEN","Only the organization owner may engage or release the Ledgerly AI emergency stop.");
    }
    const scopeId=input.scopeType==="organization"?"":String(input.scopeId??"").trim();
    if(input.scopeType==="agent"&&!scopeId)throw new AppError(422,"VALIDATION_ERROR","Agent control requires an agent ID.");
    if(input.scopeType==="agent"){
      const exists=await this.runtime.db.query(
        "SELECT 1 FROM lai_agents WHERE id=$1 AND organization_id=$2 LIMIT 1",
        [scopeId,principal.organizationId],
      );
      if(!exists.rowCount)throw new AppError(404,"LEDGERLY_AI_AGENT_NOT_FOUND","Ledgerly AI employee not found.");
    }
    const id=createId("laictl");
    await this.runtime.db.query(
      `INSERT INTO lai_ai_controls(
        id,organization_id,scope_type,scope_id,state,reason,updated_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(organization_id,scope_type,scope_id) DO UPDATE SET
        state=EXCLUDED.state,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`,
      [id,principal.organizationId,input.scopeType,scopeId,input.state,input.reason?.slice(0,1000)??null,principal.userId],
    );
    await this.privilegedAudit({
      organizationId:principal.organizationId,actorType:"user",actorId:principal.userId,
      action:"ledgerly_ai.control.changed",entityType:"ai_control",entityId:`${input.scopeType}:${scopeId}`,
      correlationId:"control:"+id,riskLevel:input.state==="stopped"?"critical":"high",
      metadata:{scopeType:input.scopeType,scopeId,state:input.state,reason:input.reason??null},
    });
    return{scopeType:input.scopeType,scopeId,state:input.state,reason:input.reason??null};
  }

  async listRules(principal:AuthPrincipal){
    if(!isAdmin(principal)&&!principal.scopes.includes("admin:read"))throw new AppError(403,"FORBIDDEN","Policy rules require administrative permission.");
    const result=await this.runtime.db.query(
      `SELECT id,name,action_pattern AS "actionPattern",agent_key AS "agentKey",min_risk AS "minRisk",
              mutating_only AS "mutatingOnly",production_only AS "productionOnly",effect,
              reviewer_role AS "reviewerRole",priority,enabled,
              created_by AS "createdBy",updated_by AS "updatedBy",
              created_at AS "createdAt",updated_at AS "updatedAt"
         FROM lai_policy_rules WHERE organization_id=$1 ORDER BY priority,id`,
      [principal.organizationId],
    );
    return result.rows;
  }

  async upsertRule(principal:AuthPrincipal,input:{
    id?:string;name:string;actionPattern:string;agentKey?:string|null;minRisk?:LedgerlyAiRiskLevel|null;
    mutatingOnly?:boolean;productionOnly?:boolean;effect:LedgerlyAiPolicyEffect;
    reviewerRole?:"admin"|"owner"|null;priority?:number;enabled?:boolean;
  }){
    if(principal.role!=="owner")throw new AppError(403,"FORBIDDEN","Only the organization owner may change Ledgerly AI policy rules.");
    const id=input.id??createId("laiprul");
    if(input.effect==="two_step"&&input.reviewerRole==="admin"){
      throw new AppError(422,"VALIDATION_ERROR","Two-step policy rules must use owner reviewers.");
    }
    await this.runtime.db.query(
      `INSERT INTO lai_policy_rules(
        id,organization_id,name,action_pattern,agent_key,min_risk,mutating_only,production_only,
        effect,reviewer_role,priority,enabled,created_by,updated_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
      ON CONFLICT(id) DO UPDATE SET
        name=EXCLUDED.name,action_pattern=EXCLUDED.action_pattern,agent_key=EXCLUDED.agent_key,
        min_risk=EXCLUDED.min_risk,mutating_only=EXCLUDED.mutating_only,
        production_only=EXCLUDED.production_only,effect=EXCLUDED.effect,
        reviewer_role=EXCLUDED.reviewer_role,priority=EXCLUDED.priority,enabled=EXCLUDED.enabled,
        updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP
      WHERE lai_policy_rules.organization_id=EXCLUDED.organization_id`,
      [
        id,principal.organizationId,input.name.slice(0,160),input.actionPattern.slice(0,240),
        input.agentKey??null,input.minRisk??null,Boolean(input.mutatingOnly),Boolean(input.productionOnly),
        input.effect,input.reviewerRole??null,input.priority??100,input.enabled??true,principal.userId,
      ],
    );
    await this.privilegedAudit({
      organizationId:principal.organizationId,actorType:"user",actorId:principal.userId,
      action:"ledgerly_ai.policy_rule.upserted",entityType:"policy_rule",entityId:id,
      correlationId:"policy:"+id,riskLevel:"critical",metadata:{...input,id},
    });
    return{id};
  }

  async deleteRule(principal:AuthPrincipal,id:string){
    if(principal.role!=="owner")throw new AppError(403,"FORBIDDEN","Only the organization owner may delete Ledgerly AI policy rules.");
    const result=await this.runtime.db.query(
      "DELETE FROM lai_policy_rules WHERE id=$1 AND organization_id=$2 RETURNING id,name",
      [id,principal.organizationId],
    );
    if(!result.rowCount)throw new AppError(404,"LEDGERLY_AI_POLICY_RULE_NOT_FOUND","Policy rule not found.");
    await this.privilegedAudit({
      organizationId:principal.organizationId,actorType:"user",actorId:principal.userId,
      action:"ledgerly_ai.policy_rule.deleted",entityType:"policy_rule",entityId:id,
      correlationId:"policy-delete:"+id,riskLevel:"critical",metadata:{name:result.rows[0].name},
    });
    return{id,deleted:true};
  }

  async auditLog(principal:AuthPrincipal,limit=200){
    if(!isAdmin(principal)&&!principal.scopes.includes("admin:read"))throw new AppError(403,"FORBIDDEN","Privileged audit requires administrative permission.");
    const result=await this.runtime.db.query(
      `SELECT id,actor_type AS "actorType",actor_id AS "actorId",action,
              entity_type AS "entityType",entity_id AS "entityId",correlation_id AS "correlationId",
              risk_level AS "riskLevel",metadata_json AS metadata,created_at AS "createdAt"
         FROM lai_privileged_audit WHERE organization_id=$1
        ORDER BY created_at DESC,id DESC LIMIT $2`,
      [principal.organizationId,Math.min(Math.max(limit,1),500)],
    );
    return result.rows;
  }
}
