import type { Env } from "../shared.js";

export type PythonResponsePurpose="analysis"|"account-for"|"report"|"comparison"|"summary"|"recommendation"|"action-preview"|"warning"|"general";
export type PythonResponseRequest={
  requestId?:string;
  purpose:PythonResponsePurpose;
  request:string;
  semanticPayload?:Record<string,unknown>;
  context?:{
    organizationId?:string;
    conversationId?:string;
    actor?:string;
    audience?:string;
    topic?:string;
    category?:string;
    entityType?:string;
    entityLabel?:string;
    recentResponses?:string[];
    locale?:string;
    currency?:string;
  };
  detail?:"brief"|"standard"|"deep";
  providerMode?:"auto"|"required"|"disabled";
  maxWords?:number;
  toolPolicy?:string[];
};
export type PythonResponseResult={
  text:string;
  provider:string;
  model:string;
  revision_count:number;
  response_fingerprint:string;
  quality:{overall:number;revision_required:boolean;[key:string]:unknown};
  plan:Record<string,unknown>;
  metadata:Record<string,unknown>;
  tool_events:Array<Record<string,unknown>>;
};

function configured(env:Env){return Boolean(String(env.RESPONSE_INTELLIGENCE_URL||"").trim());}

export async function realizeWithPythonResponseIntelligence(env:Env,input:PythonResponseRequest):Promise<PythonResponseResult|null>{
  if(!configured(env))return null;
  const base=String(env.RESPONSE_INTELLIGENCE_URL||"").replace(/\/$/,""),timeoutMs=Math.min(Math.max(Number(env.RESPONSE_INTELLIGENCE_TIMEOUT_MS||30000),1000),120000);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const headers:Record<string,string>={"Content-Type":"application/json"};
  const token=String(env.RESPONSE_INTELLIGENCE_TOKEN||"").trim();if(token)headers["X-Response-Intelligence-Token"]=token;
  try{
    const response=await fetch(base+"/v1/respond",{
      method:"POST",headers,signal:controller.signal,
      body:JSON.stringify({
        request_id:input.requestId||"",
        purpose:input.purpose,
        request:input.request,
        semantic_payload:input.semanticPayload||{},
        context:{
          organization_id:input.context?.organizationId||"",
          conversation_id:input.context?.conversationId||"",
          actor:input.context?.actor||"",
          audience:input.context?.audience||"",
          topic:input.context?.topic||"",
          category:input.context?.category||"",
          entity_type:input.context?.entityType||"",
          entity_label:input.context?.entityLabel||"",
          recent_responses:input.context?.recentResponses||[],
          locale:input.context?.locale||"en-UG",
          currency:input.context?.currency||"UGX",
        },
        detail:input.detail||"standard",
        provider_mode:input.providerMode||"auto",
        max_words:input.maxWords||1200,
        tool_policy:input.toolPolicy||[],
      }),
    });
    if(!response.ok)return null;
    const payload=await response.json().catch(()=>null) as PythonResponseResult|null;
    return payload&&typeof payload.text==="string"&&payload.text.trim()?payload:null;
  }catch{return null;}finally{clearTimeout(timer);}
}
