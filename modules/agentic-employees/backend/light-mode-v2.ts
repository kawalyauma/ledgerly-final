import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { AuthPrincipal, Env } from "../../../src/types";
import type { AgentDefinition } from "./policy";
import { resolveRuntimeProvider } from "./provider-config";
import { executeTool } from "./memory-tools-v17";
import { buildLightToolRegistry, toolsForGroups, toolsForKind, toolsForModules, type LightTaskKind, type LightToolDescriptor } from "./light-tool-registry";
import { resolveLightReferences } from "./light-reference-resolver";
import { analysisKnowledgeSummary, getAnalysisTopic, suggestAnalysisTopics, type AnalysisMode } from "./analysis-knowledge";
import { identifyAnalysisEntity, type AnalysisEntityOption } from "./analysis-entity-resolver";

type ChatMessage={role:"user"|"assistant";content:string};
type LightRunInput={db:D1Database;env:Env&{AI_PROVIDER_ENCRYPTION_KEY?:string};principal:AuthPrincipal;agent:AgentDefinition;conversationId:string;messages:ChatMessage[]};
type Runtime=Awaited<ReturnType<typeof resolveRuntimeProvider>>;
type RouteArguments={pathParams?:Record<string,string|number>;query?:Record<string,string|number|boolean|null>;body?:Record<string,unknown>;title?:string;summary?:string};
type ToolExecution={tool:LightToolDescriptor;result:unknown};
type LightResult={text:string;model:string;provider:string;providerResponseId:string|null;usage:unknown;toolEvents:Array<Record<string,unknown>>;routing:Record<string,unknown>};

const KINDS:LightTaskKind[]=["query","report","create","update","delete","action","communication","document","analysis"];

function latestUser(input:LightRunInput){return[...input.messages].reverse().find(message=>message.role==="user")?.content.trim()||"";}
function stripFence(value:string){const text=value.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"");const start=text.indexOf("{"),end=text.lastIndexOf("}");return start>=0&&end>start?text.slice(start,end+1):text;}
function parseObject<T extends Record<string,unknown>>(value:string,fallback:T):T{try{const parsed=JSON.parse(stripFence(value));return parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed as T:fallback;}catch{return fallback;}}

async function fetchJson<T>(url:string,init:RequestInit,timeoutMs:number){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(url,{...init,signal:controller.signal}),payload=await response.json().catch(()=>({})) as T;return{response,payload};}catch(error){if(error instanceof Error&&error.name==="AbortError")throw new AppError(504,"AI_PROVIDER_TIMEOUT",`Light AI request timed out after ${timeoutMs} ms.`);throw error;}finally{clearTimeout(timer);}}
function openAiText(payload:any){if(typeof payload?.output_text==="string"&&payload.output_text.trim())return payload.output_text.trim();const chunks:string[]=[];for(const item of payload?.output||[])if(item?.type==="message")for(const part of item.content||[])if(part?.type==="output_text"&&part.text)chunks.push(part.text);return chunks.join("\n").trim();}
function anthropicText(payload:any){return(payload?.content||[]).filter((part:any)=>part?.type==="text"&&part.text).map((part:any)=>part.text).join("\n").trim();}

async function cheapText(runtime:Runtime,prompt:string,maxTokens=320){
 const timeout=Math.min(runtime.config.timeoutMs,45000);
 if(runtime.provider==="openai"){
  const{response,payload}=await fetchJson<any>(`${runtime.baseUrl}/responses`,{method:"POST",headers:{Authorization:`Bearer ${runtime.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:runtime.model,instructions:"Be concise. Follow the requested output format exactly. Do not invent Ledgerly data or IDs.",input:prompt,max_output_tokens:maxTokens})},timeout);
  if(!response.ok)throw new AppError(502,"AI_PROVIDER_ERROR",payload?.error?.message||`Light AI request failed (${response.status})`);return{text:openAiText(payload),id:payload?.id||null,usage:payload?.usage||null};
 }
 if(runtime.provider==="google"){
  const{response,payload}=await fetchJson<any>(`${runtime.baseUrl}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${runtime.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:runtime.model,messages:[{role:"system",content:"Be concise. Follow the requested output format exactly. Do not invent Ledgerly data or IDs."},{role:"user",content:prompt}],max_tokens:maxTokens,temperature:0})},timeout);
  if(!response.ok)throw new AppError(502,"AI_PROVIDER_ERROR",payload?.error?.message||`Light AI request failed (${response.status})`);return{text:String(payload?.choices?.[0]?.message?.content||"").trim(),id:payload?.id||null,usage:payload?.usage||null};
 }
 const{response,payload}=await fetchJson<any>(`${runtime.baseUrl}/messages`,{method:"POST",headers:{"x-api-key":runtime.apiKey,"anthropic-version":"2023-06-01","Content-Type":"application/json"},body:JSON.stringify({model:runtime.model,system:"Be concise. Follow the requested output format exactly. Do not invent Ledgerly data or IDs.",messages:[{role:"user",content:prompt}],max_tokens:maxTokens,temperature:0})},timeout);
 if(!response.ok)throw new AppError(502,"AI_PROVIDER_ERROR",payload?.error?.message||`Light AI request failed (${response.status})`);return{text:anthropicText(payload),id:payload?.id||null,usage:payload?.usage||null};
}
async function cheapJson<T extends Record<string,unknown>>(runtime:Runtime,prompt:string,fallback:T,maxTokens=260){const result=await cheapText(runtime,`${prompt}\n\nReturn JSON only. No markdown.`,maxTokens);return{value:parseObject(result.text,fallback),id:result.id,usage:result.usage};}
async function stage<T>(input:LightRunInput,name:string,work:()=>Promise<T>){const id=createId("aat");await input.db.prepare(`INSERT INTO ae_tool_calls(id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status) VALUES (?,?,?,?,?,?,?,'running')`).bind(id,input.principal.organizationId,input.conversationId,input.agent.key,input.principal.userId,name,"{}").run();try{const result=await work();await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(JSON.stringify(result).slice(0,12000),id,input.principal.organizationId).run();return result;}catch(error){const message=error instanceof Error?error.message:String(error);await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(message,id,input.principal.organizationId).run();throw error;}}

function words(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(Boolean);}
function lexicalScore(query:string,tool:LightToolDescriptor){const q=new Set(words(query)),hay=words(`${tool.name} ${tool.description} ${tool.aliases.join(" ")} ${tool.module} ${tool.group}`);let score=0;for(const token of hay)if(q.has(token))score+=token.length>4?3:1;return score;}
function shortlist(query:string,tools:LightToolDescriptor[],limit=36){return[...tools].map(tool=>({tool,score:lexicalScore(query,tool)})).sort((a,b)=>b.score-a.score||a.tool.name.localeCompare(b.tool.name)).slice(0,limit).map(item=>item.tool);}
function inferKinds(prompt:string):LightTaskKind[]{const v=prompt.toLowerCase(),result:LightTaskKind[]=[];if(/\b(create|add|register|open|new|make)\b/.test(v))result.push("create");if(/\b(update|edit|change|rename|modify|move)\b/.test(v))result.push("update");if(/\b(delete|remove)\b/.test(v))result.push("delete");if(/\b(report|statement|summary|analytics)\b/.test(v))result.push("report");if(/\b(pdf|excel|xlsx|presentation|powerpoint|pptx|word|docx|print)\b/.test(v))result.push("document");if(/\b(send|message|sms|whatsapp|notify)\b/.test(v))result.push("communication");if(/\b(analy[sz]e|compare|why|trend|relationship)\b/.test(v))result.push("analysis");if(!result.length||/\b(check|show|find|get|list|what|who|how much|balance)\b/.test(v))result.unshift("query");return[...new Set(result)].slice(0,4);}
function validKinds(value:unknown,fallback:LightTaskKind[]){const raw=Array.isArray(value)?value.map(String):[],picked=raw.filter((kind):kind is LightTaskKind=>KINDS.includes(kind as LightTaskKind));return picked.length?[...new Set(picked)].slice(0,5):fallback;}
function enrichKinds(kinds:LightTaskKind[],format:"pdf"|"xlsx"|"pptx"|"docx"|null,prompt:string){const result=[...kinds];if(result.includes("analysis")){result.push("query","report");}if(result.includes("report"))result.push("query");if(result.includes("communication"))result.push("query");if(format&&documentNeedsLedgerlyData(prompt))result.push("query","report");return[...new Set(result)].slice(0,6);}
function validSelections(value:unknown,allowed:string[],max=6){const set=new Set(allowed),raw=Array.isArray(value)?value.map(String):[];return[...new Set(raw.filter(item=>set.has(item)))].slice(0,max);}
function formatTools(tools:LightToolDescriptor[]){return tools.map(tool=>({name:tool.name,kind:tool.kind,module:tool.module,group:tool.group,source:tool.source,description:tool.description.slice(0,220),aliases:tool.aliases.slice(0,5)}));}
function requestedFormat(prompt:string):"pdf"|"xlsx"|"pptx"|"docx"|null{const v=prompt.toLowerCase();if(/\bpdf\b/.test(v))return"pdf";if(/\b(excel|xlsx|spreadsheet|workbook)\b/.test(v))return"xlsx";if(/\b(powerpoint|pptx|presentation|slides?)\b/.test(v))return"pptx";if(/\b(word|docx)\b/.test(v))return"docx";return null;}
function documentNeedsLedgerlyData(prompt:string){return/\b(report|statement|summary|balance|arrears|attendance|student|learner|staff|teacher|fees?|finance|academic|inventory|stock|payroll|class|exam|collection|performance|budget|bank|journal)\b/i.test(prompt);}

function routeInputHint(path:string,method:string){const key=`${method.toUpperCase()} ${path}`,exact:Record<string,string>={
 "POST /api/v1/school/setup/classLevels":"Body: code, name, sequenceNo; optional educationLevel, promotionLevelId, terminal, active.",
 "POST /api/v1/school/setup/classes":"Body: classLevelId, code, name; optional academicYearId, campusId, departmentId, capacity, classTeacherUserId, active. Put a human class-level name in classLevelId when only the name is known.",
 "POST /api/v1/school/setup/streams":"Body: classId, code, name; optional campusId, capacity, classTeacherUserId, active. Put a human class name in classId when only the name is known.",
 "POST /api/v1/school/setup/subjects":"Body: code, name; optional departmentId, shortName, subjectType, curriculumCode, passMark, maxMark, active, metadata.",
 "POST /api/v1/school/setup/academicYears":"Body: code, name, startsOn, endsOn; optional status, isCurrent.",
 "POST /api/v1/school/setup/terms":"Body: academicYearId, code, name, sequenceNo, startsOn, endsOn; optional status, isCurrent.",
 "POST /api/v1/school/setup/departments":"Body: code, name; optional campusId, description, headUserId, parentId, active.",
 "POST /api/v1/school/setup/feeCategories":"Body: code, name; optional description, incomeAccountId, receivableAccountId, productId, taxable, taxCode, refundable, mandatory, active, metadata.",
 "POST /api/v1/school/setup/paymentMethods":"Body: code, name, methodType; optional accountId, configuration, active.",
 "POST /api/v1/school/student-management/students":"Body requires firstName, lastName and admissionDate. Optional middleName, preferredName, gender, dateOfBirth, nationality, phone, email, physicalAddress, admissionClassLevelId, currentAcademicYearId, currentClassId, currentStreamId, admissionNumber, studentNumber, guardian, residencyStatus and status. Human class/stream/year names may be put in corresponding *Id fields for Ledgerly to resolve.",
 "POST /api/v1/school/staff-management/staff":"Body requires firstName, lastName and hireDate. Optional staffNumber, gender, phone, email, departmentId, positionId, campusId, employmentType, employmentStatus, isTeacher, payType, basePayMinor, currency, userId, notes and emergencyContact. Human department/position/campus names may be supplied in the corresponding *Id fields.",
};if(exact[key])return exact[key];if(method==="GET")return"Use path parameters and query filters only when supplied or implied. Never invent IDs.";return"Build the smallest request body needed. Never invent an ID. If a required foreign key is known only by human name, put that name in the corresponding *Id field for deterministic resolution.";}
function codeFromName(value:string,fallback:string){return value.replace(/[^A-Za-z0-9]+/g,"").toUpperCase().slice(0,40)||fallback;}
function applyCommonDefaults(tool:LightToolDescriptor,body:Record<string,unknown>){const path=tool.pathTemplate||"";if(tool.method==="POST"&&path==="/api/v1/school/setup/classes"){if(typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"CLASS");if(typeof body.name==="string"&&!body.classLevelId)body.classLevelId=body.name;}if(tool.method==="POST"&&path==="/api/v1/school/setup/classLevels"&&typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"LEVEL");if(tool.method==="POST"&&path==="/api/v1/school/setup/streams"&&typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"STREAM");if(tool.method==="POST"&&path==="/api/v1/school/setup/subjects"&&typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"SUBJECT");if(tool.method==="POST"&&path==="/api/v1/school/setup/departments"&&typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"DEPT");if(tool.method==="POST"&&path==="/api/v1/school/setup/feeCategories"&&typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"FEE");if(tool.method==="POST"&&path==="/api/v1/school/setup/paymentMethods"&&typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"PAY");if(tool.method==="POST"&&path==="/api/v1/school/student-management/students"&&!body.admissionDate)body.admissionDate=new Date().toISOString().slice(0,10);if(tool.method==="POST"&&path==="/api/v1/school/staff-management/staff"&&!body.hireDate)body.hireDate=new Date().toISOString().slice(0,10);return body;}
const REQUIRED_BODY:Record<string,Array<[string,string]>>={
 "POST /api/v1/school/setup/classLevels":[["name","class-level name"],["code","class-level code"],["sequenceNo","sequence number"]],
 "POST /api/v1/school/setup/classes":[["name","class name"],["code","class code"],["classLevelId","class level"]],
 "POST /api/v1/school/setup/streams":[["name","stream name"],["code","stream code"],["classId","class"]],
 "POST /api/v1/school/setup/subjects":[["name","subject name"],["code","subject code"]],
 "POST /api/v1/school/setup/academicYears":[["name","academic-year name"],["code","academic-year code"],["startsOn","start date"],["endsOn","end date"]],
 "POST /api/v1/school/setup/terms":[["name","term name"],["code","term code"],["academicYearId","academic year"],["sequenceNo","term sequence"],["startsOn","start date"],["endsOn","end date"]],
 "POST /api/v1/school/setup/departments":[["name","department name"],["code","department code"]],
 "POST /api/v1/school/setup/feeCategories":[["name","fee-category name"],["code","fee-category code"]],
 "POST /api/v1/school/setup/paymentMethods":[["name","payment-method name"],["code","payment-method code"],["methodType","payment method type"]],
 "POST /api/v1/school/student-management/students":[["firstName","student first name"],["lastName","student last name"],["admissionDate","admission date"]],
 "POST /api/v1/school/staff-management/staff":[["firstName","staff first name"],["lastName","staff last name"],["hireDate","hire date"]],
};
function missingRouteRequirements(tool:LightToolDescriptor,body:Record<string,unknown>){const requirements=REQUIRED_BODY[`${tool.method} ${tool.pathTemplate}`]||[];return requirements.filter(([field])=>body[field]===undefined||body[field]===null||String(body[field]).trim()==="").map(([,label])=>label);}

function genericReferenceKey(pathTemplate:string,param:string){if(param!=="id")return param;const segments=pathTemplate.split("/").filter(Boolean),index=segments.findIndex(segment=>segment===`:${param}`),resource=index>0?segments[index-1].toLowerCase():"";const map:Record<string,string>={students:"studentId",guardians:"guardianId",classes:"classId",classlevels:"classLevelId",streams:"streamId",subjects:"subjectId",terms:"termId",academicyears:"academicYearId",departments:"departmentId",staff:"staffId",employees:"staffId",accounts:"accountId",contacts:"contactId",products:"productId",feecategories:"feeCategoryId",paymentmethods:"paymentMethodId"};return map[resource]||param;}
async function resolvePathParams(input:LightRunInput,tool:LightToolDescriptor,params:Record<string,string|number>){const out:Record<string,string|number>={},issues:string[]=[];for(const[key,raw]of Object.entries(params)){if(typeof raw!=="string"){out[key]=raw;continue;}const referenceKey=genericReferenceKey(tool.pathTemplate||"",key);const resolved=await resolveLightReferences(input.db,input.principal.organizationId,{[referenceKey]:raw});const value=(resolved.value as Record<string,unknown>)[referenceKey];out[key]=typeof value==="string"||typeof value==="number"?value:raw;issues.push(...resolved.issues);}return{value:out,issues};}
function fillPath(template:string,params:Record<string,string|number>){const missing:string[]=[];const path=template.replace(/:([A-Za-z0-9_]+)/g,(_all,key)=>{const value=params[key];if(value===undefined||value===null||String(value).trim()===""){missing.push(key);return`:${key}`;}return encodeURIComponent(String(value));});return{path,missing};}
function appendQuery(path:string,query:Record<string,string|number|boolean|null>){const entries=Object.entries(query).filter(([,value])=>value!==null&&value!==undefined&&String(value)!=="");if(!entries.length)return path;return`${path}${path.includes("?")?"&":"?"}${entries.map(([key,value])=>`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}`;}
function scopeFor(path:string){const p=path.toLowerCase();if(p.includes("/accounts"))return"accounts:write";if(p.includes("/journals"))return"journals:write";if(p.includes("/reports"))return"reports:write";if(p.includes("/contacts"))return"contacts:write";if(p.includes("/documents")||p.includes("/files"))return"documents:write";if(p.includes("/payments")||p.includes("/banking"))return"payments:write";if(p.includes("/payroll"))return"payroll:write";if(p.includes("/communications"))return"communications:write";if(p.includes("/products")||p.includes("/inventory"))return"products:write";return"school:write";}
function tinyHash(value:string){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}
async function prepareRouteAction(input:LightRunInput,tool:LightToolDescriptor,path:string,body:unknown,title:string,summary:string){const method=tool.method||"POST",payload={agentKey:input.agent.key,method,path,body},key=`conversation:${input.conversationId}:light:${method}:${path}:${tinyHash(JSON.stringify(body))}`,id=createId("aea");await input.db.prepare(`INSERT INTO ae_actions(id,organization_id,agent_key,action_type,title,summary,required_scope,payload_json,idempotency_key,status) VALUES(?,?,?,?,?,?,?,?,?,'suggested') ON CONFLICT(organization_id,idempotency_key) DO NOTHING`).bind(id,input.principal.organizationId,input.agent.key,"system.api.request",title.slice(0,240),summary.slice(0,600),scopeFor(path),JSON.stringify(payload),key).run();const action=await input.db.prepare("SELECT id,status,title,action_type AS actionType,required_scope AS requiredScope FROM ae_actions WHERE organization_id=? AND idempotency_key=?").bind(input.principal.organizationId,key).first();return{prepared:true,executed:false,requiresHumanApproval:true,approvalSurface:"chat",action};}

async function extractNativeArguments(runtime:Runtime,tool:LightToolDescriptor,prompt:string){const schema=JSON.stringify(tool.parameters||{type:"object",properties:{}}).slice(0,7000);const result=await cheapJson<Record<string,unknown>>(runtime,`Extract arguments for the Ledgerly tool ${tool.name}. Description: ${tool.description}\nJSON schema: ${schema}\nUser request: ${prompt}\nReturn exactly the argument object expected by the tool.`,{},600);return result.value;}
async function extractRouteArguments(runtime:Runtime,tool:LightToolDescriptor,prompt:string){const result=await cheapJson<RouteArguments>(runtime,`Extract arguments for this exact Ledgerly operation. Method/path: ${tool.method} ${tool.pathTemplate}. ${routeInputHint(tool.pathTemplate||"",tool.method||"GET")}\nUser request: ${prompt}\nReturn {"pathParams":{},"query":{},"body":{},"title":"short approval title","summary":"what will happen"}. Keep omitted fields omitted.`,{},650);return result.value;}

async function executeSelected(input:LightRunInput,runtime:Runtime,tool:LightToolDescriptor,prompt:string,events:Array<Record<string,unknown>>):Promise<ToolExecution>{
 const extracted=await stage(input,`light_extract_${tool.module.replace(/[^a-z0-9]+/gi,"_").toLowerCase()}`,()=>tool.source==="native"?extractNativeArguments(runtime,tool,prompt):extractRouteArguments(runtime,tool,prompt));
 const logId=createId("aat");await input.db.prepare(`INSERT INTO ae_tool_calls(id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status) VALUES(?,?,?,?,?,?,?,'running')`).bind(logId,input.principal.organizationId,input.conversationId,input.agent.key,input.principal.userId,tool.name,JSON.stringify(extracted)).run();
 try{
  let result:unknown;
  if(tool.source==="native")result=await executeTool({db:input.db,env:input.env,principal:input.principal,agent:input.agent,conversationId:input.conversationId,requestedTools:null},tool.nativeName||tool.name,extracted);
  else{
   if(!input.env.AGENT_SYSTEM_GATEWAY)throw new Error("Ledgerly Light requires the self-hosted system gateway");
   const args=extracted as RouteArguments,pathResolution=await resolvePathParams(input,tool,args.pathParams||{});if(pathResolution.issues.length)result={needsClarification:true,issues:pathResolution.issues};
   else{const filled=fillPath(tool.pathTemplate||"",pathResolution.value);if(filled.missing.length)result={needsClarification:true,issues:[`The request needs ${filled.missing.join(", ")} before it can run.`]};else{const path=appendQuery(filled.path,args.query||{}),body=applyCommonDefaults(tool,{...(args.body||{})}),missing=missingRouteRequirements(tool,body);if(missing.length)result={needsClarification:true,issues:[`Please provide ${missing.join(", ")}.`]};else{const resolved=await resolveLightReferences(input.db,input.principal.organizationId,body);if(resolved.issues.length)result={needsClarification:true,issues:resolved.issues};else if(tool.readOnly){const response=await input.env.AGENT_SYSTEM_GATEWAY.request({agentKey:input.agent.key,principal:input.principal,method:tool.method||"GET",path,body:tool.method==="GET"?undefined:resolved.value});if(!response.ok)throw new Error(`Ledgerly API ${response.status}: ${JSON.stringify(response.data).slice(0,1800)}`);result=response.data;}else result=await prepareRouteAction(input,tool,path,resolved.value,args.title||`${tool.kind} ${tool.group}`,args.summary||`Prepared from: ${prompt}`);}}}
  }
  await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(JSON.stringify(result).slice(0,20000),logId,input.principal.organizationId).run();events.push({id:logId,tool:tool.name,status:"succeeded"});return{tool,result};
 }catch(error){const message=error instanceof Error?error.message:String(error);await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(message,logId,input.principal.organizationId).run();events.push({id:logId,tool:tool.name,status:"failed",error:message});return{tool,result:{error:message}};}
}

async function prepareDocumentFromResults(input:LightRunInput,runtime:Runtime,prompt:string,format:"pdf"|"xlsx"|"pptx"|"docx",results:unknown[],events:Array<Record<string,unknown>>){const verified=JSON.stringify(results).slice(0,20000),spec=await stage(input,"light_build_document",()=>cheapJson<Record<string,unknown>>(runtime,`Build a professional ${format.toUpperCase()} document specification using ONLY these verified Ledgerly results. Never invent a figure. User request: ${prompt}\nVerified data: ${verified}\nReturn a JSON report structure using subtitle, summary, dataAsOf, sources, sections, tables, charts, sheets and slides where useful. Tables carry exact figures. Charts only use verified numeric comparisons. Default to white background and black/dark text.`,{},1600)),title=await cheapJson<{title?:string}>(runtime,`Create a short professional file title for: ${prompt}\nReturn {"title":"..."}.`,{title:"Ledgerly Report"},100),args={title:String(title.value.title||"Ledgerly Report").slice(0,180),format,contentJson:JSON.stringify(spec.value)},logId=createId("aat");await input.db.prepare(`INSERT INTO ae_tool_calls(id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status) VALUES(?,?,?,?,?,?,?,'running')`).bind(logId,input.principal.organizationId,input.conversationId,input.agent.key,input.principal.userId,"prepare_document",JSON.stringify({title:args.title,format})).run();try{const result=await executeTool({db:input.db,env:input.env,principal:input.principal,agent:input.agent,conversationId:input.conversationId,requestedTools:null},"prepare_document",args);await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(JSON.stringify(result),logId,input.principal.organizationId).run();events.push({id:logId,tool:"prepare_document",status:"succeeded"});return result;}catch(error){const message=error instanceof Error?error.message:String(error);await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(message,logId,input.principal.organizationId).run();events.push({id:logId,tool:"prepare_document",status:"failed",error:message});throw error;}}

export async function runLightAgent(input:LightRunInput):Promise<LightResult>{
 const prompt=latestUser(input);if(!prompt)throw new AppError(422,"VALIDATION_ERROR","A user message is required");
 const runtime=await resolveRuntimeProvider(input.db,input.env,input.principal.organizationId,"luna"),registry=await stage(input,"light_build_registry",()=>buildLightToolRegistry(input.env,input.principal,input.agent)),fallbackKinds=inferKinds(prompt),format=requestedFormat(prompt);
 const kindStage=await stage(input,"light_route_type",()=>cheapJson<{types?:unknown}>(runtime,`Classify this Ledgerly request into the necessary task types from: ${KINDS.join(", ")}. Request: ${prompt}\nReturn {"types":[...]}.`,{types:fallbackKinds},180));
 let kinds=enrichKinds(validKinds(kindStage.value.types,fallbackKinds),format,prompt);
 let candidates=toolsForKind(registry,kinds);if(!candidates.length)candidates=registry.tools;
 const availableModules=[...new Set(candidates.map(tool=>tool.module))].sort(),moduleStage=await stage(input,"light_route_module",()=>cheapJson<{modules?:unknown}>(runtime,`Choose the Ledgerly modules needed for this request. Available: ${availableModules.join(", ")}. Request: ${prompt}\nReturn {"modules":[...]}, maximum 6.`,{modules:availableModules.slice(0,1)},220));
 let modules=validSelections(moduleStage.value.modules,availableModules,6);if(!modules.length)modules=availableModules.slice(0,1);candidates=toolsForModules(candidates,modules);if(!candidates.length)candidates=toolsForModules(registry.tools,modules);
 if(candidates.length>42){const groups=[...new Set(candidates.map(tool=>tool.group))].sort(),groupStage=await stage(input,"light_route_group",()=>cheapJson<{groups?:unknown}>(runtime,`Choose the relevant Ledgerly subgroups for: ${prompt}\nAvailable: ${groups.join(", ")}\nReturn {"groups":[...]}, maximum 5.`,{groups:groups.slice(0,2)},220)),picked=validSelections(groupStage.value.groups,groups,5),grouped=toolsForGroups(candidates,picked);if(grouped.length)candidates=grouped;}
 candidates=shortlist(prompt,candidates,36);
 if(format&&documentNeedsLedgerlyData(prompt)){const dataCandidates=candidates.filter(tool=>!(tool.source==="native"&&["prepare_document","prepare_print_document","list_saved_documents"].includes(tool.name)));if(dataCandidates.length)candidates=dataCandidates;}
 const selectStage=await stage(input,"light_route_tool",()=>cheapJson<{tools?:unknown}>(runtime,`Choose the exact tools needed to fully complete this request. Prefer the fewest tools. Writes become approval cards and must never execute directly. Request: ${prompt}\nCandidates: ${JSON.stringify(formatTools(candidates))}\nReturn {"tools":["exact_name",...]}, maximum 6.`,{tools:candidates.slice(0,1).map(tool=>tool.name)},650)),selectedNames=validSelections(selectStage.value.tools,candidates.map(tool=>tool.name),6),selected=(selectedNames.length?selectedNames:[candidates[0]?.name]).filter(Boolean).map(name=>candidates.find(tool=>tool.name===name)!).filter(Boolean);
 if(!selected.length)throw new AppError(409,"LIGHT_TOOL_NOT_FOUND","Light Mode could not find a permitted Ledgerly capability for this request. Advanced Mode can still use system discovery.");
 const events:Array<Record<string,unknown>>=[],executed:ToolExecution[]=[];for(const tool of selected)executed.push(await executeSelected(input,runtime,tool,prompt,events));
 const results=executed.map(item=>({tool:item.tool.name,module:item.tool.module,kind:item.tool.kind,result:item.result})),issues=results.flatMap(item=>{const value=item.result as any;return value?.needsClarification&&Array.isArray(value.issues)?value.issues:[]});
 const routing={mode:"light",kinds,modules,selected:selected.map(tool=>tool.name),registry:registry.stats};
 if(issues.length)return{text:`I need one detail before I can safely continue: ${[...new Set(issues)].join(" ")}`,model:runtime.model,provider:runtime.provider,providerResponseId:null,usage:null,toolEvents:events,routing};
 const alreadyPreparedDocument=results.some(item=>item.tool==="prepare_document"&&(item.result as any)?.prepared);
 if(format&&!alreadyPreparedDocument){await prepareDocumentFromResults(input,runtime,prompt,format,results,events);return{text:`I prepared the ${format.toUpperCase()} output from verified Ledgerly data. Review or edit the document approval below, then approve it to generate the file.`,model:runtime.model,provider:runtime.provider,providerResponseId:null,usage:null,toolEvents:events,routing};}
 const prepared=results.filter(item=>(item.result as any)?.prepared&&(item.result as any)?.requiresHumanApproval);if(prepared.length)return{text:prepared.length===1?"I prepared the requested Ledgerly action. Review or edit the approval card below, then approve it when ready.":`I prepared ${prepared.length} Ledgerly actions. Review or edit the approval cards below before approving them.`,model:runtime.model,provider:runtime.provider,providerResponseId:null,usage:null,toolEvents:events,routing};
 const answer=await stage(input,"light_write_answer",()=>cheapText(runtime,`Answer using ONLY the verified Ledgerly results. Be concise but complete. Use a markdown table for exact comparisons when useful. Never invent missing values.\nUser request: ${prompt}\nVerified results: ${JSON.stringify(results).slice(0,22000)}`,900));return{text:answer.text||"I completed the Ledgerly lookup but could not format the final answer.",model:runtime.model,provider:runtime.provider,providerResponseId:answer.id,usage:answer.usage,toolEvents:events,routing};
}


type CompositePlanStep={tool:string;purpose?:string;instruction?:string};
type CompositeCompiled={title?:string;joinKey?:string;columns?:unknown;rows?:unknown;summary?:unknown;appliedFilters?:unknown;calculations?:unknown;missingData?:unknown;notes?:unknown};

function compositeSearchText(prompt:string){
 let extra="";
 if(/\b(attendance|absent|present|late)\b/i.test(prompt))extra+=" student class attendance report present absent marked percentage";
 if(/\b(fee|fees|balance|arrears|outstanding|billing)\b/i.test(prompt))extra+=" school fees balances arrears billed paid outstanding student";
 if(/\b(performance|academic|grade|marks?|results?|division|aggregate)\b/i.test(prompt))extra+=" academics exams results report cards marks grades aggregate division";
 if(/\b(last|previous|current|term|year|compare|trend|fallen|improved|declined)\b/i.test(prompt))extra+=" terms academic years exams comparison current previous";
 if(/\b(class|p[1-7]|learner|student)\b/i.test(prompt))extra+=" students classes streams enrollment";
 return (prompt+" "+extra).trim();
}
function compositeCandidate(tool:LightToolDescriptor){return{name:tool.name,module:tool.module,group:tool.group,kind:tool.kind,source:tool.source,method:tool.method,path:tool.pathTemplate,description:tool.description.slice(0,260),aliases:tool.aliases.slice(0,6)};}
function compositeStrings(value:unknown){return Array.isArray(value)?value.map(String).map(x=>x.trim()).filter(Boolean):[];}
function compositeObjectRows(value:unknown):Record<string,unknown>[]{
 const seen=new Set<unknown>();let best:Record<string,unknown>[]=[];
 function visit(node:unknown,depth:number){if(depth>5||node===null||node===undefined||seen.has(node))return;if(typeof node==="object")seen.add(node);
  if(Array.isArray(node)){const rows=node.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)) as Record<string,unknown>[];if(rows.length>best.length)best=rows;for(const item of node.slice(0,30))visit(item,depth+1);return;}
  if(typeof node==="object")for(const child of Object.values(node as Record<string,unknown>))visit(child,depth+1);
 }
 visit(value,0);return best.slice(0,1000);
}
function sanitizeComposite(value:CompositeCompiled,fallbackRows:Record<string,unknown>[]){
 const rows=Array.isArray(value.rows)?value.rows.filter(row=>row&&typeof row==="object"&&!Array.isArray(row)).slice(0,1000) as Record<string,unknown>[]:fallbackRows;
 const columns=compositeStrings(value.columns);const derived=columns.length?columns:[...new Set(rows.flatMap(row=>Object.keys(row)))].slice(0,40);
 return{title:String(value.title||"Composite Ledgerly Report").slice(0,180),joinKey:String(value.joinKey||"studentId").slice(0,80),columns:derived,rows,summary:value.summary??{},appliedFilters:compositeStrings(value.appliedFilters),calculations:compositeStrings(value.calculations),missingData:compositeStrings(value.missingData),notes:compositeStrings(value.notes)};
}

export async function runCompositeReport(input:LightRunInput,prompt:string){
 const request=String(prompt||"").trim();if(!request)throw new AppError(422,"VALIDATION_ERROR","Describe the report you want Ledgerly to build.");
 const runtime=await resolveRuntimeProvider(input.db,input.env,input.principal.organizationId,"luna");
 const registry=await stage(input,"composite_build_registry",()=>buildLightToolRegistry(input.env,input.principal,input.agent));
 const readable=registry.tools.filter(tool=>tool.readOnly&&(tool.kind==="query"||tool.kind==="report"||tool.kind==="analysis"));
 if(!readable.length)throw new AppError(409,"COMPOSITE_REPORT_UNAVAILABLE","No permitted read capabilities are available for this AI employee.");
 const candidates=shortlist(compositeSearchText(request),readable,60);
 const plannerPrompt="Plan a READ-ONLY composite Ledgerly report. The user may combine school, attendance, fees, exams, staff, books or finance data.\nUser request: "+request+"\nAvailable READ-ONLY capabilities: "+JSON.stringify(candidates.map(compositeCandidate))+"\nReturn JSON with steps, questions and joinKey. Each step is {tool,purpose,instruction}. Rules: use 1 to 8 steps and only exact tool names above; the same tool may appear more than once when comparing periods; put prerequisite lookups before dependent reads; prefer studentId/staffId/guardianId as join keys; never join different people only because names look similar; resolve relative periods such as last term from Ledgerly data when possible; questions is only for criteria impossible to resolve safely; never select a write capability.";
 const planner=await stage(input,"composite_plan",()=>cheapJson<{steps?:unknown;questions?:unknown;joinKey?:unknown}>(runtime,plannerPrompt,{steps:[],questions:[],joinKey:"studentId"},1500));
 const allowed=new Map(candidates.map(tool=>[tool.name,tool]));
 const rawSteps=Array.isArray(planner.value.steps)?planner.value.steps as Array<Record<string,unknown>>:[];
 const steps=rawSteps.map(step=>({tool:String(step.tool||""),purpose:String(step.purpose||""),instruction:String(step.instruction||"")})).filter(step=>allowed.has(step.tool)).slice(0,8);
 const questions=compositeStrings(planner.value.questions);
 const plan={joinKey:String(planner.value.joinKey||"studentId"),steps:(steps.length?steps:candidates.slice(0,1).map(tool=>({tool:tool.name,purpose:"Fetch the primary data requested",instruction:request})))};
 if(questions.length)return{mode:"composite-report",request,needsCriteria:true,questions,plan,data:{columns:[],rows:[],summary:{},appliedFilters:[],calculations:[],missingData:questions,notes:[]},sources:[]};
 const events:Array<Record<string,unknown>>=[],executed:Array<ToolExecution&{purpose:string;instruction:string}>=[];
 for(const step of plan.steps){
  const tool=allowed.get(step.tool);if(!tool)continue;
  const previous=executed.length?"\nPrevious verified step results (use IDs/periods from these when needed): "+JSON.stringify(executed.map(item=>({tool:item.tool.name,purpose:item.purpose,result:item.result}))).slice(0,10000):"";
  const instruction="Composite report step: "+(step.instruction||step.purpose||request)+"\nOverall user request: "+request+previous+"\nThis step is read-only. Do not invent IDs, dates or records.";
  const item=await executeSelected(input,runtime,tool,instruction,events);
  executed.push({...item,purpose:step.purpose,instruction:step.instruction});
  const issueValue=item.result as any;if(issueValue?.needsClarification)break;
 }
 const issues=executed.flatMap(item=>{const value=item.result as any;return value?.needsClarification&&Array.isArray(value.issues)?value.issues.map(String):[];});
 const sourcePayload=executed.map(item=>({tool:item.tool.name,module:item.tool.module,purpose:item.purpose,result:item.result}));
 const sourceInfo=executed.map(item=>({tool:item.tool.name,module:item.tool.module,purpose:item.purpose,rowCount:compositeObjectRows(item.result).length}));
 if(issues.length)return{mode:"composite-report",request,needsCriteria:true,questions:[...new Set(issues)],plan,data:{columns:[],rows:[],summary:{},appliedFilters:[],calculations:[],missingData:[...new Set(issues)],notes:[]},sources:sourceInfo,toolEvents:events};
 const fallbackRows=sourcePayload.length===1?compositeObjectRows(sourcePayload[0]!.result):[];
 const compilePrompt="Compile a structured composite report using ONLY the verified Ledgerly source results below.\nUser request: "+request+"\nPreferred join key: "+plan.joinKey+"\nVerified sources: "+JSON.stringify(sourcePayload).slice(0,36000)+"\nReturn JSON {title,joinKey,columns,rows,summary,appliedFilters,calculations,missingData,notes}. Never invent a learner, ID, amount, mark, attendance count, date or other source fact. Join learner data by studentId whenever available; never merge people merely by matching names. Apply every numeric/comparison condition exactly. For attendance percentage calculate only from verified counts and state the formula. For academic trend compare verified current and previous performance values and state the measure. Values ending in Minor are minor-unit values; do not silently reinterpret currency scale. If a human-currency threshold cannot be compared safely, put that in missingData instead of guessing. Keep rows flat and export-friendly. Include studentId plus a human identifier/name when available. If a requested field cannot be derived, list it in missingData. Rows must contain only records satisfying the requested filters.";
 const compiled=await stage(input,"composite_compile",()=>cheapJson<CompositeCompiled>(runtime,compilePrompt,{title:"Composite Ledgerly Report",joinKey:plan.joinKey,columns:[],rows:fallbackRows,summary:{},appliedFilters:[],calculations:[],missingData:[],notes:[]},5200));
 const data=sanitizeComposite(compiled.value,fallbackRows);
 return{mode:"composite-report",request,needsCriteria:false,questions:[],plan,data,sources:sourceInfo,toolEvents:events,model:runtime.model,provider:runtime.provider};
}


type GuidedAnalysisSection={title?:unknown;analysis?:unknown;evidence?:unknown;metrics?:unknown};
type GuidedAnalysisCompiled={
 title?:unknown;summary?:unknown;sections?:unknown;findings?:unknown;metrics?:unknown;relationships?:unknown;
 limitations?:unknown;unanswered?:unknown;suggestedActions?:unknown;rows?:unknown;confidenceNote?:unknown;
};
function analysisArray(value:unknown){return Array.isArray(value)?value:[];}
function analysisStrings(value:unknown){return analysisArray(value).map(String).map(x=>x.trim()).filter(Boolean);}
function sanitizeGuidedAnalysis(value:GuidedAnalysisCompiled){
 const sections=analysisArray(value.sections).filter(x=>x&&typeof x==="object").slice(0,12).map((x:any)=>({
  title:String(x.title||"Analysis").slice(0,160),analysis:String(x.analysis||"").slice(0,6000),
  evidence:analysisStrings(x.evidence).slice(0,20),metrics:analysisArray(x.metrics).slice(0,20)
 }));
 const rows=analysisArray(value.rows).filter(x=>x&&typeof x==="object"&&!Array.isArray(x)).slice(0,1000);
 return{
  title:String(value.title||"Ledgerly Analysis").slice(0,180),summary:String(value.summary||"").slice(0,8000),sections,
  findings:analysisArray(value.findings).slice(0,30),metrics:analysisArray(value.metrics).slice(0,40),
  relationships:analysisArray(value.relationships).slice(0,30),limitations:analysisStrings(value.limitations).slice(0,30),
  unanswered:analysisStrings(value.unanswered).slice(0,30),suggestedActions:analysisArray(value.suggestedActions).slice(0,30),
  rows,confidenceNote:String(value.confidenceNote||"").slice(0,2000)
 };
}
function guidedCapabilitySearch(prompt:string,topicText:string){return (prompt+" "+topicText).slice(0,12000);}

export async function runGuidedAnalysis(input:LightRunInput,payload:{mode:AnalysisMode;prompt:string;topicId?:string|null;entity?:AnalysisEntityOption|null}){
 const mode:AnalysisMode=payload.mode==="account-for"?"account-for":"analyse",request=String(payload.prompt||"").trim();
 if(!request)throw new AppError(422,"VALIDATION_ERROR","Describe what you want Ledgerly to analyse.");
 const runtime=await resolveRuntimeProvider(input.db,input.env,input.principal.organizationId,"luna");
 const registry=await stage(input,"analysis_build_registry",()=>buildLightToolRegistry(input.env,input.principal,input.agent));
 const readable=registry.tools.filter(tool=>tool.readOnly&&(tool.kind==="query"||tool.kind==="report"||tool.kind==="analysis"));
 if(!readable.length)throw new AppError(409,"ANALYSIS_UNAVAILABLE","No permitted read capabilities are available for this AI employee.");

 let topic=getAnalysisTopic(payload.topicId||null);
 if(!topic){
  const suggestions=suggestAnalysisTopics(mode,request,readable.map(tool=>tool.name+" "+tool.description+" "+tool.aliases.join(" ")).join(" ")).slice(0,12);
  const classified=await stage(input,"analysis_classify_topic",()=>cheapJson<{topicId?:unknown}>(runtime,
   "Choose the best investigation topic for this request. Return one topicId or an empty string if none is a good fit.\nRequest: "+request+"\nTopics: "+JSON.stringify(suggestions.map(item=>({id:item.id,label:item.label,description:item.description,evidence:item.evidence.slice(0,5)}))),
   {topicId:suggestions[0]?.id||""},300));
  topic=getAnalysisTopic(String(classified.value.topicId||""))||suggestions[0]||null;
 }
 const knowledge=analysisKnowledgeSummary(topic);
 let entity=payload.entity||null,entityResolution:any=null;
 if(!entity){
  const extracted=await stage(input,"analysis_extract_entity",()=>cheapJson<{mention?:unknown;types?:unknown}>(runtime,
   "Extract the primary named Ledgerly entity only if the user clearly names one specific person, account, class, stream, subject, department, term, product or contact. Do not treat generic phrases such as P6 learners, all teachers or the school as a named entity. Return {mention:'',types:[]} when there is no specific named entity.\nRequest: "+request+"\nLikely entity types for this topic: "+JSON.stringify(topic?.entityTypes||[]),
   {mention:"",types:[]},260));
  const mention=String(extracted.value.mention||"").trim(),types=analysisStrings(extracted.value.types);
  if(mention.length>=2){
   entityResolution=await identifyAnalysisEntity(input.db,input.principal.organizationId,mention,types.length?types:topic?.entityTypes);
   if(entityResolution.status==="resolved")entity=entityResolution.entity;
   else if(entityResolution.status==="ambiguous")return{mode,request,topic,needsEntity:true,entityQuery:mention,entityOptions:entityResolution.options,needsCriteria:false,questions:[],plan:null,analysis:null,sources:[]};
  }
 }

 const topicText=topic?[topic.label,topic.description,...topic.keywords,...topic.evidence].join(" "):knowledge;
 const candidates=shortlist(guidedCapabilitySearch(request,topicText),readable,72);
 const plannerPrompt="Build a fresh READ-ONLY evidence investigation for Ledgerly. This is not a report template. Select evidence because it can answer this exact request.\nMode: "+mode+"\nRequest: "+request+"\nResolved entity: "+JSON.stringify(entity)+"\nInvestigation knowledge: "+knowledge+"\nAvailable capabilities: "+JSON.stringify(candidates.map(compositeCandidate))+"\nReturn {steps:[{tool,purpose,instruction}],questions:[],joinKey}. Use 1 to 10 steps. The same read tool may appear more than once for different periods or comparison groups. Use the resolved entity ID/type exactly when present. Include comparison/baseline evidence when it materially helps. For account-for requests, investigate competing explanations and counter-evidence; do not jump from correlation to causation. Never use a write tool. Ask questions only when a required identifier, period or comparison truly cannot be resolved from Ledgerly.";
 const planned=await stage(input,"analysis_plan",()=>cheapJson<{steps?:unknown;questions?:unknown;joinKey?:unknown}>(runtime,plannerPrompt,{steps:[],questions:[],joinKey:entity?.type==="staff"||entity?.type==="teacher"?"staffId":"studentId"},1800));
 const rawSteps=Array.isArray(planned.value.steps)?planned.value.steps as Array<Record<string,unknown>>:[],allowed=new Map(candidates.map(tool=>[tool.name,tool]));
 const steps=rawSteps.map(step=>({tool:String(step.tool||""),purpose:String(step.purpose||""),instruction:String(step.instruction||"")})).filter(step=>allowed.has(step.tool)).slice(0,10);
 const questions=analysisStrings(planned.value.questions);
 const plan={joinKey:String(planned.value.joinKey||"studentId"),steps:steps.length?steps:candidates.slice(0,1).map(tool=>({tool:tool.name,purpose:"Retrieve primary evidence",instruction:request}))};
 if(questions.length)return{mode,request,topic,entity,needsEntity:false,needsCriteria:true,questions,plan,analysis:null,sources:[]};

 const events:Array<Record<string,unknown>>=[],executed:Array<ToolExecution&{purpose:string;instruction:string}>=[];
 for(const step of plan.steps){
  const tool=allowed.get(step.tool);if(!tool)continue;
  const prior=executed.length?"\nVerified results from earlier steps that may provide IDs, dates or baselines: "+JSON.stringify(executed.map(item=>({tool:item.tool.name,purpose:item.purpose,result:item.result}))).slice(0,12000):"";
  const instruction="Investigation step purpose: "+(step.purpose||"evidence")+"\nStep instruction: "+(step.instruction||request)+"\nOverall request: "+request+"\nResolved entity: "+JSON.stringify(entity)+prior+"\nUse only read operations and never invent an ID, period or record.";
  const item=await executeSelected(input,runtime,tool,instruction,events);executed.push({...item,purpose:step.purpose,instruction:step.instruction});
  const v=item.result as any;if(v?.needsClarification)break;
 }
 const issues=executed.flatMap(item=>{const v=item.result as any;return v?.needsClarification&&Array.isArray(v.issues)?v.issues.map(String):[];});
 const sources=executed.map(item=>({tool:item.tool.name,module:item.tool.module,purpose:item.purpose,rowCount:compositeObjectRows(item.result).length}));
 if(issues.length)return{mode,request,topic,entity,needsEntity:false,needsCriteria:true,questions:[...new Set(issues)],plan,analysis:null,sources,toolEvents:events};

 const verified=executed.map(item=>({tool:item.tool.name,module:item.tool.module,purpose:item.purpose,result:item.result}));
 const compilePrompt="Perform a genuine evidence-based Ledgerly "+(mode==="account-for"?"explanation/investigation":"analysis")+". Do NOT fill a fixed report template and do NOT force the same headings used in other analyses. Decide the number and titles of sections from the evidence and the user's question.\nRequest: "+request+"\nTopic knowledge (a checklist of evidence to consider, not conclusions): "+knowledge+"\nResolved entity: "+JSON.stringify(entity)+"\nVerified Ledgerly evidence: "+JSON.stringify(verified).slice(0,42000)+"\nReturn JSON {title,summary,sections:[{title,analysis,evidence,metrics}],findings,metrics,relationships,limitations,unanswered,suggestedActions,rows,confidenceNote}.\nRules: every factual claim must be traceable to verified evidence above; distinguish direct facts, calculations, associations and explanations; never invent missing records; never infer private motives; never blame a teacher, learner or guardian from correlation alone; for account-for, identify strongest observed contributors, counter-evidence and alternative explanations, and explicitly say when causation cannot be established; use comparisons and calculations only when their denominators/periods are compatible; suggestedActions are advisory only and must not claim they were executed; rows should be flat supporting data when useful. Vary the analysis structure according to what the evidence actually shows.";
 const compiled=await stage(input,"analysis_synthesize",()=>cheapJson<GuidedAnalysisCompiled>(runtime,compilePrompt,{title:topic?.label||"Ledgerly Analysis",summary:"",sections:[],findings:[],metrics:[],relationships:[],limitations:[],unanswered:[],suggestedActions:[],rows:[],confidenceNote:""},6200));
 return{mode,request,topic,entity,needsEntity:false,needsCriteria:false,questions:[],plan,analysis:sanitizeGuidedAnalysis(compiled.value),sources,toolEvents:events,model:runtime.model,provider:runtime.provider};
}
