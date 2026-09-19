import { createHash } from "node:crypto";
import type { LedgerlyAiRiskLevel } from "../types.js";

export type IncidentSignalInput={
  organizationId?:string|null;
  source:string;
  signalType:"http"|"exception"|"queue"|"health"|"manual";
  message:string;
  title?:string;
  code?:string|null;
  httpStatus?:number|null;
  path?:string|null;
  method?:string|null;
  moduleKey?:string|null;
  correlationId?:string|null;
  stack?:string|null;
  context?:Record<string,unknown>;
};

export type IncidentClassification={
  fingerprint:string;
  severity:LedgerlyAiRiskLevel;
  assignedAgentKey:"kato"|"maya"|"tendo"|"nia"|"jabali"|"safi";
  moduleKey:string;
  title:string;
  autoProcess:boolean;
};

function compact(value:string){
  return value.replace(/s+/g," ").trim();
}
function normalizedMessage(value:string){
  return compact(value)
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,"<uuid>")
    .replace(/[a-z]+_[a-z0-9]{12,}/gi,"<id>")
    .replace(/[0-9a-f]{20,}/gi,"<hash>")
    .replace(/d+/g,"#")
    .slice(0,700);
}
function normalizedPath(value:string|undefined|null){
  if(!value)return "";
  return value
    .split("?")[0]!
    .replace(//d+(?=/|$)/g,"/:id")
    .replace(//[0-9a-f]{8}-[0-9a-f-]{27,}(?=/|$)/gi,"/:id")
    .replace(//[a-z]+_[a-z0-9]{12,}(?=/|$)/gi,"/:id")
    .slice(0,500);
}
export function affectedModule(pathValue?:string|null,explicit?:string|null){
  if(explicit?.trim())return explicit.trim().slice(0,120);
  const path=normalizedPath(pathValue);
  const match=//api/v1/([^/]+)/.exec(path);
  if(match?.[1])return match[1].slice(0,120);
  if(path.startsWith("/auth"))return "core-identity";
  if(path.startsWith("/system"))return "platform";
  return "unknown";
}

function textForClassification(input:IncidentSignalInput,moduleKey:string){
  return [
    input.message,input.code??"",input.path??"",input.source,input.signalType,moduleKey,
    typeof input.context?.component==="string"?input.context.component:"",
    typeof input.context?.jobKind==="string"?input.context.jobKind:"",
  ].join(" ").toLowerCase();
}

export function classifyIncident(input:IncidentSignalInput):IncidentClassification{
  const moduleKey=affectedModule(input.path,input.moduleKey);
  const text=textForClassification(input,moduleKey);
  let assignedAgentKey:IncidentClassification["assignedAgentKey"]="kato";
  if(/(sql|postgres|database|migration|constraint|foreign key|deadlock|serialization)/.test(text))assignedAgentKey="tendo";
  if(/(react|vite|frontend|browser|tsx|css|hydration|chunk|bundle)/.test(text))assignedAgentKey="maya";
  if(/(test|vitest|assert|expect|qa|typecheck|typescript build)/.test(text))assignedAgentKey="nia";
  if(/(docker|nginx|redis|storage|queue|worker|scheduler|502|503|gateway|connection refused|econnrefused)/.test(text))assignedAgentKey="jabali";
  if(/(secret|credential|token leak|injection|privilege escalation|authorization bypass|auth bypass|xss|csrf|ssrf|path traversal|security)/.test(text))assignedAgentKey="safi";

  let severity:LedgerlyAiRiskLevel="low";
  const status=input.httpStatus??0;
  if(status>=500)severity="high";
  else if(status===429||status===404||status===401||status===403)severity="low";
  else if(status>=400)severity="medium";
  if(input.signalType==="queue"&&Number(input.context?.attempts??0)>=Number(input.context?.maxAttempts??999))severity="high";
  if(input.signalType==="health")severity="high";
  if(/(data loss|corruption|credential leak|secret leak|authorization bypass|privilege escalation|remote code execution|rce)/.test(text))severity="critical";
  if(/(payment|journal|payroll|fees|accounting)/.test(text)&&status>=500&&severity==="high")severity="critical";

  const fingerprintSource=JSON.stringify({
    source:input.source,
    signalType:input.signalType,
    moduleKey,
    code:(input.code??"").toUpperCase(),
    status:input.httpStatus??null,
    method:(input.method??"").toUpperCase(),
    path:normalizedPath(input.path),
    message:normalizedMessage(input.message),
  });
  const fingerprint=createHash("sha256").update(fingerprintSource).digest("hex");
  const title=compact(input.title||[
    input.code?String(input.code):"",
    input.httpStatus?String(input.httpStatus):"",
    input.message,
  ].filter(Boolean).join(" · ")).slice(0,220)||"Ledgerly engineering incident";
  return{
    fingerprint,
    severity,
    assignedAgentKey,
    moduleKey,
    title,
    autoProcess:severity==="high"||severity==="critical",
  };
}

export function riskForChangedPaths(paths:string[]):LedgerlyAiRiskLevel{
  const normalized=paths.map(path=>path.toLowerCase());
  if(normalized.some(path=>
    path.includes("/migrations/")||
    path.includes("core-identity")||
    path.includes("/auth")||
    path.includes("security")||
    path.includes("payroll")||
    path.includes("accounting")||
    path.includes("finance")||
    path.includes("payments")
  ))return "critical";
  if(normalized.some(path=>
    path.startsWith("node-backend/src/")||
    path.includes("/backend/")||
    path.startsWith("selfhost/")
  ))return "high";
  if(normalized.some(path=>
    path.startsWith("web/")||
    path.includes("/frontend/")||
    /.(tsx|jsx|css)$/.test(path)
  ))return "medium";
  return "low";
}
