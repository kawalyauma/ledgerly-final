import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import type { Runtime } from "../../../runtime.js";
import { createId } from "../../core-identity/security.js";
import { redactLedgerlyAiValue } from "../gateway/redaction.js";
import type { LedgerlyAiEmployee } from "../employees/types.js";

const RESERVED_METADATA_KEYS=/^(?:principal|role|scopes?|permissions?|organization(?:id)?|user(?:id)?|authorization|api[_-]?key|token|secret|password|system[_-]?prompt|developer[_-]?prompt)$/i;
const RESERVED_TOOL_KEYS=/^(?:__proto__|prototype|constructor|principal|scopeOverride|scopesOverride|permissionOverride|permissionsOverride|authorization|api[_-]?key|token|secret|password|systemPrompt|developerPrompt|toolCall)$/i;

function safeRecord(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}
function findReserved(value:unknown,pattern:RegExp,path:string[]=[]):string[]{
  if(Array.isArray(value))return value.flatMap((item,index)=>findReserved(item,pattern,[...path,String(index)]));
  if(!value||typeof value!=="object")return[];
  const found:string[]=[];
  for(const [key,item] of Object.entries(value as Record<string,unknown>)){
    if(pattern.test(key))found.push([...path,key].join("."));
    found.push(...findReserved(item,pattern,[...path,key]));
  }
  return found;
}
function hasControlCharacters(value:unknown):boolean{
  if(typeof value==="string")return /[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
  if(Array.isArray(value))return value.some(hasControlCharacters);
  if(value&&typeof value==="object")return Object.values(value as Record<string,unknown>).some(hasControlCharacters);
  return false;
}

export class LedgerlyAiSecurityService{
  constructor(private readonly runtime:Runtime){}

  assertTenant(principal:AuthPrincipal,organizationId:string|null|undefined,entityType="resource",entityId?:string|null){
    if(!organizationId||organizationId!==principal.organizationId){
      throw new AppError(404,"LEDGERLY_AI_RESOURCE_NOT_FOUND",`Ledgerly AI ${entityType} not found.`,entityId?{entityId}:undefined);
    }
  }

  async sanitizeRequestMetadata(
    principal:AuthPrincipal,metadata:Record<string,unknown>|undefined,correlationId:string,
  ){
    const value=safeRecord(metadata);
    const reserved=findReserved(value,RESERVED_METADATA_KEYS);
    if(reserved.length){
      await this.audit({
        principal,action:"ledgerly_ai.security.context_escalation_denied",
        entityType:"request_context",correlationId,riskLevel:"high",
        metadata:{keys:reserved.slice(0,20)},
      });
      throw new AppError(
        422,"LEDGERLY_AI_RESERVED_CONTEXT_KEY",
        "Request context may not override identity, organization, permissions, secrets, or system instructions.",
        {keys:reserved.slice(0,20)},
      );
    }
    if(hasControlCharacters(value)){
      await this.audit({
        principal,action:"ledgerly_ai.security.context_control_characters_denied",
        entityType:"request_context",correlationId,riskLevel:"medium",
      });
      throw new AppError(422,"LEDGERLY_AI_CONTEXT_CONTROL_CHARACTERS","Request context contains unsupported control characters.");
    }
    return redactLedgerlyAiValue(value) as Record<string,unknown>;
  }

  async assertToolBoundary(input:{
    principal:AuthPrincipal;employee:LedgerlyAiEmployee|null;toolName:string;arguments:unknown;correlationId:string;
  }){
    const reserved=findReserved(input.arguments,RESERVED_TOOL_KEYS);
    if(reserved.length){
      await this.audit({
        principal:input.principal,action:"ledgerly_ai.security.tool_boundary_denied",
        entityType:"tool",entityId:input.toolName,correlationId:input.correlationId,riskLevel:"high",
        metadata:{agentId:input.employee?.id??null,keys:reserved.slice(0,20)},
      });
      throw new AppError(
        422,"LEDGERLY_AI_TOOL_BOUNDARY_REJECTED",
        "Structured tool arguments attempted to override Ledgerly identity, permissions, secrets, or execution control.",
        {toolName:input.toolName,keys:reserved.slice(0,20)},
      );
    }
    if(hasControlCharacters(input.arguments)){
      await this.audit({
        principal:input.principal,action:"ledgerly_ai.security.tool_control_characters_denied",
        entityType:"tool",entityId:input.toolName,correlationId:input.correlationId,riskLevel:"medium",
        metadata:{agentId:input.employee?.id??null},
      });
      throw new AppError(422,"LEDGERLY_AI_TOOL_BOUNDARY_REJECTED","Structured tool arguments contain unsupported control characters.",{toolName:input.toolName});
    }
  }

  async audit(input:{
    principal?:AuthPrincipal;organizationId?:string;actorType?:"user"|"agent"|"system";actorId?:string;
    action:string;entityType:string;entityId?:string|null;correlationId:string;
    riskLevel?:"low"|"medium"|"high"|"critical";metadata?:Record<string,unknown>;
  }){
    const organizationId=input.principal?.organizationId??input.organizationId;
    if(!organizationId)return;
    const actorType=input.actorType??(input.principal?"user":"system");
    const actorId=input.actorId??input.principal?.userId??"ledgerly-ai";
    await this.runtime.db.query(
      `INSERT INTO lai_privileged_audit(
        id,organization_id,actor_type,actor_id,action,entity_type,entity_id,correlation_id,risk_level,metadata_json
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        createId("laisec"),organizationId,actorType,actorId,input.action,input.entityType,input.entityId??null,
        input.correlationId,input.riskLevel??null,JSON.stringify(redactLedgerlyAiValue(input.metadata??{})),
      ],
    );
  }
}
