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
  generation?:{
    provider?:string;
    apiStyle:"responses"|"chat-completions"|"anthropic";
    baseUrl:string;
    apiKey?:string;
    model:string;
    timeoutSeconds?:number;
  };
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
        generation:input.generation?{
          provider:input.generation.provider||"",
          api_style:input.generation.apiStyle,
          base_url:input.generation.baseUrl,
          api_key:input.generation.apiKey||"",
          model:input.generation.model,
          timeout_seconds:input.generation.timeoutSeconds||45,
        }:null,
        max_words:input.maxWords||1200,
        tool_policy:input.toolPolicy||[],
      }),
    });
    if(!response.ok)return null;
    const payload=await response.json().catch(()=>null) as PythonResponseResult|null;
    return payload&&typeof payload.text==="string"&&payload.text.trim()?payload:null;
  }catch{return null;}finally{clearTimeout(timer);}
}


export async function checkPythonResponseIntelligence(env:Env):Promise<Record<string,unknown>>{
  const base=String(env.RESPONSE_INTELLIGENCE_URL||"").trim().replace(/\/$/,"");
  if(!base)return{configured:false,reachable:false,status:"not-configured"};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(Math.max(Number(env.RESPONSE_INTELLIGENCE_TIMEOUT_MS||30000),1000),15000));
  try{
    const response=await fetch(base+"/health",{signal:controller.signal});
    if(!response.ok)return{configured:true,reachable:true,status:"unhealthy",httpStatus:response.status};
    const payload=await response.json().catch(()=>({})) as Record<string,unknown>;
    return{configured:true,reachable:true,...payload};
  }catch(error){
    return{configured:true,reachable:false,status:"unreachable",error:error instanceof Error?error.message:String(error)};
  }finally{clearTimeout(timer);}
}


async function trainingRequest<T>(
  env:Env,
  path:string,
  init:RequestInit={},
):Promise<T|null>{
  if(!configured(env))return null;
  const base=String(env.RESPONSE_INTELLIGENCE_URL||"").replace(/\/$/,"");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(Math.max(Number(env.RESPONSE_INTELLIGENCE_TIMEOUT_MS||30000),1000),120000));
  const headers:Record<string,string>={"Content-Type":"application/json",...(init.headers as Record<string,string>||{})};
  const token=String(env.RESPONSE_INTELLIGENCE_TOKEN||"").trim();if(token)headers["X-Response-Intelligence-Token"]=token;
  try{
    const response=await fetch(base+path,{...init,headers,signal:controller.signal});
    if(!response.ok)return null;
    return await response.json().catch(()=>null) as T|null;
  }catch{return null;}finally{clearTimeout(timer);}
}

export async function submitPythonResponseFeedback(env:Env,input:{
  organizationId:string;
  exampleId?:string;
  responseFingerprint:string;
  rating:-1|0|1;
  comment?:string;
  correctionText?:string;
  entityLabel?:string;
  approveOriginal?:boolean;
  trustedReviewer?:boolean;
}):Promise<Record<string,unknown>|null>{
  return trainingRequest<Record<string,unknown>>(env,"/v1/training/feedback",{
    method:"POST",
    body:JSON.stringify({
      organization_id:input.organizationId,
      example_id:input.exampleId||"",
      response_fingerprint:input.responseFingerprint,
      rating:input.rating,
      comment:input.comment||"",
      correction_text:input.correctionText||"",
      entity_label:input.entityLabel||"",
      approve_original:Boolean(input.approveOriginal),
      trusted_reviewer:Boolean(input.trustedReviewer),
    }),
  });
}

export async function getPythonLearningStatus(env:Env,organizationId:string):Promise<Record<string,unknown>|null>{
  return trainingRequest<Record<string,unknown>>(env,"/v1/training/stats?organization_id="+encodeURIComponent(organizationId));
}

export async function setPythonTrainingExampleStatus(
  env:Env,
  organizationId:string,
  exampleId:string,
  status:"approve"|"reject",
):Promise<Record<string,unknown>|null>{
  const query="?organization_id="+encodeURIComponent(organizationId);
  return trainingRequest<Record<string,unknown>>(env,"/v1/training/examples/"+encodeURIComponent(exampleId)+"/"+status+query,{method:"POST"});
}


export async function getPythonTrainingExamples(
  env:Env,
  organizationId:string,
  status="candidate",
  limit=100,
):Promise<Array<Record<string,unknown>>|null>{
  const query=new URLSearchParams({
    organization_id:organizationId,status_filter:status,limit:String(Math.max(1,Math.min(limit,500))),
  });
  return trainingRequest<Array<Record<string,unknown>>>(env,"/v1/training/examples?"+query.toString());
}


export async function getPythonStyleProfile(env:Env,organizationId:string):Promise<Record<string,unknown>|null>{
  return trainingRequest<Record<string,unknown>>(env,"/v1/training/style-profile?organization_id="+encodeURIComponent(organizationId));
}

export async function getPythonTrainingRuns(env:Env,organizationId:string,limit=50):Promise<Array<Record<string,unknown>>|null>{
  const query=new URLSearchParams({organization_id:organizationId,limit:String(Math.max(1,Math.min(limit,200)))});
  return trainingRequest<Array<Record<string,unknown>>>(env,"/v1/training/runs?"+query.toString());
}

export async function getPythonAdapters(env:Env,organizationId:string):Promise<Array<Record<string,unknown>>|null>{
  return trainingRequest<Array<Record<string,unknown>>>(env,"/v1/training/adapters?organization_id="+encodeURIComponent(organizationId));
}


export async function exportPythonTrainingDataset(
  env:Env,
  organizationId:string,
  format:"sft"|"dpo",
):Promise<Record<string,unknown>|null>{
  return trainingRequest<Record<string,unknown>>(env,"/v1/training/export",{
    method:"POST",
    body:JSON.stringify({
      organization_id:organizationId,
      format,
      min_quality:0.88,
      include_global:true,
    }),
  });
}

export async function activatePythonAdapter(
  env:Env,
  organizationId:string,
  adapterId:string,
):Promise<Record<string,unknown>|null>{
  const query="?organization_id="+encodeURIComponent(organizationId);
  return trainingRequest<Record<string,unknown>>(env,"/v1/training/adapters/"+encodeURIComponent(adapterId)+"/activate"+query,{method:"POST"});
}
