import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { AuthPrincipal, Env } from "../../../src/types";
import type { AgentDefinition } from "./policy";
import { resolveRuntimeProvider } from "./provider-config";
import { executeTool } from "./memory-tools-v17";
import { buildLightToolRegistry, toolsForKind, toolsForModules, toolsForGroups, type LightTaskKind, type LightToolDescriptor } from "./light-tool-registry";

type ChatMessage = { role: "user" | "assistant"; content: string };
type LightRunInput = {
  db: D1Database;
  env: Env & { AI_PROVIDER_ENCRYPTION_KEY?: string };
  principal: AuthPrincipal;
  agent: AgentDefinition;
  conversationId: string;
  messages: ChatMessage[];
};

type LightResult = { text: string; model: string; provider: string; providerResponseId: string | null; usage: unknown; toolEvents: Array<Record<string, unknown>>; routing?: Record<string, unknown> };
type Runtime = Awaited<ReturnType<typeof resolveRuntimeProvider>>;

type RouteArguments = {
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | null>;
  body?: Record<string, unknown>;
  title?: string;
  summary?: string;
};

const KINDS: LightTaskKind[] = ["query","report","create","update","delete","action","communication","document","analysis"];
const WRITE_KINDS = new Set<LightTaskKind>(["create","update","delete","action","communication","document"]);

function latestUser(input: LightRunInput) {
  return [...input.messages].reverse().find(message => message.role === "user")?.content.trim() || "";
}

function stripFence(value: string) {
  const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function jsonObject<T extends Record<string, unknown>>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(stripFence(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : fallback;
  } catch { return fallback; }
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ payload: T; response: Response }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({})) as T;
    return { payload, response };
  } finally { clearTimeout(timer); }
}

function openAiText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const chunks: string[] = [];
  for (const item of payload?.output || []) if (item?.type === "message") for (const part of item.content || []) if (part?.type === "output_text" && part.text) chunks.push(part.text);
  return chunks.join("\n").trim();
}

function anthropicText(payload: any) {
  return (payload?.content || []).filter((part: any) => part?.type === "text" && part.text).map((part: any) => part.text).join("\n").trim();
}

async function cheapText(runtime: Runtime, prompt: string, maxTokens = 320) {
  const timeout = Math.min(runtime.config.timeoutMs, 45000);
  if (runtime.provider === "openai") {
    const { payload, response } = await fetchJson<any>(`${runtime.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: runtime.model, instructions: "Be concise and follow the requested output format exactly.", input: prompt, max_output_tokens: maxTokens, reasoning: { effort: "low" } }),
    }, timeout);
    if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload?.error?.message || `Light AI request failed (${response.status})`);
    return { text: openAiText(payload), id: payload?.id || null, usage: payload?.usage || null };
  }
  if (runtime.provider === "google") {
    const { payload, response } = await fetchJson<any>(`${runtime.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: runtime.model, messages: [{ role: "system", content: "Be concise and follow the requested output format exactly." }, { role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0 }),
    }, timeout);
    if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload?.error?.message || `Light AI request failed (${response.status})`);
    return { text: String(payload?.choices?.[0]?.message?.content || "").trim(), id: payload?.id || null, usage: payload?.usage || null };
  }
  const { payload, response } = await fetchJson<any>(`${runtime.baseUrl}/messages`, {
    method: "POST",
    headers: { "x-api-key": runtime.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: runtime.model, system: "Be concise and follow the requested output format exactly.", messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0 }),
  }, timeout);
  if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload?.error?.message || `Light AI request failed (${response.status})`);
  return { text: anthropicText(payload), id: payload?.id || null, usage: payload?.usage || null };
}

async function cheapJson<T extends Record<string, unknown>>(runtime: Runtime, prompt: string, fallback: T, maxTokens = 260) {
  const result = await cheapText(runtime, `${prompt}\n\nReturn JSON only. No markdown.`, maxTokens);
  return { value: jsonObject(result.text, fallback), id: result.id, usage: result.usage };
}

async function stage<T>(input: LightRunInput, name: string, work: () => Promise<T>) {
  const id = createId("aat");
  await input.db.prepare(`INSERT INTO ae_tool_calls(id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status)
    VALUES (?,?,?,?,?,?,?,'running')`).bind(id,input.principal.organizationId,input.conversationId,input.agent.key,input.principal.userId,name,"{}").run();
  try {
    const result = await work();
    await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(JSON.stringify(result).slice(0,12000),id,input.principal.organizationId).run();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(message,id,input.principal.organizationId).run();
    throw error;
  }
}

function words(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g," ").split(/\s+/).filter(Boolean); }
function lexicalScore(query: string, tool: LightToolDescriptor) {
  const q = new Set(words(query));
  const hay = words(`${tool.name} ${tool.description} ${tool.aliases.join(" ")} ${tool.module} ${tool.group}`);
  let score = 0;
  for (const token of hay) if (q.has(token)) score += token.length > 4 ? 3 : 1;
  return score;
}
function shortlist(query: string, tools: LightToolDescriptor[], limit = 36) {
  return [...tools].map(tool => ({ tool, score: lexicalScore(query, tool) })).sort((a,b) => b.score-a.score || a.tool.name.localeCompare(b.tool.name)).slice(0,limit).map(item => item.tool);
}

function inferKinds(prompt: string): LightTaskKind[] {
  const v = prompt.toLowerCase();
  const kinds: LightTaskKind[] = [];
  if (/\b(create|add|register|open|new|make)\b/.test(v)) kinds.push("create");
  if (/\b(update|edit|change|rename|modify|move)\b/.test(v)) kinds.push("update");
  if (/\b(delete|remove)\b/.test(v)) kinds.push("delete");
  if (/\b(report|statement|summary|analytics)\b/.test(v)) kinds.push("report");
  if (/\b(pdf|excel|xlsx|presentation|powerpoint|pptx|word|docx|print)\b/.test(v)) kinds.push("document");
  if (/\b(send|message|sms|whatsapp|notify)\b/.test(v)) kinds.push("communication");
  if (/\b(analy[sz]e|compare|why|trend|relationship)\b/.test(v)) kinds.push("analysis");
  if (!kinds.length || /\b(check|show|find|get|list|what|who|how much|balance)\b/.test(v)) kinds.unshift("query");
  return [...new Set(kinds)].slice(0,4);
}

function formatToolList(tools: LightToolDescriptor[]) {
  return tools.map(tool => ({ name:tool.name, kind:tool.kind, module:tool.module, group:tool.group, source:tool.source, description:tool.description.slice(0,220), aliases:tool.aliases.slice(0,5) }));
}

function validKinds(value: unknown, fallback: LightTaskKind[]) {
  const raw = Array.isArray(value) ? value.map(String) : [];
  const picked = raw.filter((kind): kind is LightTaskKind => KINDS.includes(kind as LightTaskKind));
  return picked.length ? [...new Set(picked)].slice(0,4) : fallback;
}

function validSelections(value: unknown, allowed: string[], max = 6) {
  const set = new Set(allowed);
  const raw = Array.isArray(value) ? value.map(String) : [];
  return [...new Set(raw.filter(item => set.has(item)))].slice(0,max);
}

function routeInputHint(path: string, method: string) {
  const key = `${method.toUpperCase()} ${path}`;
  const exact: Record<string,string> = {
    "POST /api/v1/school/setup/classLevels":"Body: code, name, sequenceNo; optional educationLevel, promotionLevelId, terminal, active.",
    "POST /api/v1/school/setup/classes":"Body: classLevelId, code, name; optional academicYearId, campusId, departmentId, capacity, classTeacherUserId, active. Human class-level names may be supplied in classLevelId and Ledgerly Light will resolve them.",
    "POST /api/v1/school/setup/streams":"Body: classId, code, name; optional campusId, capacity, classTeacherUserId, active. Human class names may be supplied in classId and will be resolved.",
    "POST /api/v1/school/setup/subjects":"Body: code, name; optional departmentId, shortName, subjectType, curriculumCode, passMark, maxMark, active, metadata.",
    "POST /api/v1/school/setup/academicYears":"Body: code, name, startsOn, endsOn; optional status, isCurrent.",
    "POST /api/v1/school/setup/terms":"Body: academicYearId, code, name, sequenceNo, startsOn, endsOn; optional status, isCurrent.",
    "POST /api/v1/school/setup/departments":"Body: code, name; optional campusId, description, headUserId, parentId, active.",
    "POST /api/v1/school/setup/feeCategories":"Body: code, name; optional description, incomeAccountId, receivableAccountId, productId, taxable, taxCode, refundable, mandatory, active, metadata.",
    "POST /api/v1/school/setup/paymentMethods":"Body: code, name, methodType; optional accountId, configuration, active.",
    "POST /api/v1/school/student-management/students":"Body requires firstName, lastName, admissionDate. Optional middleName, preferredName, gender, dateOfBirth, nationality, phone, email, physicalAddress, admissionClassLevelId, currentAcademicYearId, currentClassId, currentStreamId, admissionNumber, studentNumber, guardian, residencyStatus, status and other profile fields. Use human class/stream/year names in the corresponding *Id field if necessary; Ledgerly Light resolves them before creating the approval.",
  };
  if (exact[key]) return exact[key];
  if (method === "GET") return "Use path parameters and query filters only when the user supplied or implied them. Do not invent IDs.";
  return "Build the smallest request body supported by the user's instruction. Never invent IDs. If a required foreign-key field is known only by human name, place that human name in the corresponding *Id field so Ledgerly Light can resolve it deterministically.";
}

function fillPath(template: string, params: Record<string,string|number> = {}) {
  let path = template;
  const missing: string[] = [];
  path = path.replace(/:([A-Za-z0-9_]+)/g, (_all,key) => {
    const value = params[key];
    if (value === undefined || value === null || String(value).trim() === "") { missing.push(key); return `:${key}`; }
    return encodeURIComponent(String(value));
  });
  return { path, missing };
}

function appendQuery(path: string, query: Record<string,string|number|boolean|null> = {}) {
  const pairs = Object.entries(query).filter(([,value]) => value !== null && value !== undefined && String(value) !== "");
  if (!pairs.length) return path;
  const qs = pairs.map(([key,value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&");
  return `${path}${path.includes("?")?"&":"?"}${qs}`;
}

function looksLikeId(value: string) {
  return /^[a-z]{2,12}_[A-Za-z0-9-]{4,}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

type RefSpec = { table:string; idColumn?:string; returnColumn?:string; textColumns:string[]; active?:string };
const REFERENCES: Record<string,RefSpec> = {
  campusid:{table:"school_branches",textColumns:["code","name"],active:"active"},
  academicyearid:{table:"school_academic_years",textColumns:["code","name"]}, currentacademicyearid:{table:"school_academic_years",textColumns:["code","name"]},
  termid:{table:"school_terms",textColumns:["code","name"]},
  classlevelid:{table:"school_class_levels",textColumns:["code","name"],active:"active"}, admissionclasslevelid:{table:"school_class_levels",textColumns:["code","name"],active:"active"}, desiredclasslevelid:{table:"school_class_levels",textColumns:["code","name"],active:"active"},
  classid:{table:"school_classes",textColumns:["code","name"],active:"active"}, currentclassid:{table:"school_classes",textColumns:["code","name"],active:"active"},
  streamid:{table:"school_streams",textColumns:["code","name"],active:"active"}, currentstreamid:{table:"school_streams",textColumns:["code","name"],active:"active"},
  subjectid:{table:"school_subjects",textColumns:["code","name"],active:"active"},
  departmentid:{table:"school_departments",textColumns:["code","name"],active:"active"},
  gradingscaleid:{table:"school_grading_scales",textColumns:["code","name"],active:"active"},
  feecategoryid:{table:"school_fee_categories",textColumns:["code","name"],active:"active"},
  paymentmethodid:{table:"school_payment_methods",textColumns:["code","name"],active:"active"},
  studentid:{table:"school_students",textColumns:["admission_number","student_number","first_name","last_name"]},
  guardianid:{table:"school_guardians",textColumns:["first_name","last_name","phone_primary","email"],active:"active"},
  staffid:{table:"school_staff_profiles",textColumns:["staff_number","first_name","last_name"]},
  teacheruserid:{table:"school_staff_profiles",returnColumn:"user_id",textColumns:["staff_number","first_name","last_name"]}, class teacheruserid:{table:"school_staff_profiles",returnColumn:"user_id",textColumns:["staff_number","first_name","last_name"]},
  classTeacherUserId:{table:"school_staff_profiles",returnColumn:"user_id",textColumns:["staff_number","first_name","last_name"]},
  accountid:{table:"accounts",textColumns:["code","name"]}, incomeaccountid:{table:"accounts",textColumns:["code","name"]}, receivableaccountid:{table:"accounts",textColumns:["code","name"]},
  productid:{table:"products",textColumns:["sku","name"]}, contactid:{table:"contacts",textColumns:["code","name","email"]},
};

function refSpec(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g,"");
  if (normalized === "classteacheruserid" || normalized === "headuserid" || normalized === "assigneeuserid") return {table:"school_staff_profiles",returnColumn:"user_id",textColumns:["staff_number","first_name","last_name"]} as RefSpec;
  return REFERENCES[normalized];
}

async function resolveReference(db:D1Database, organizationId:string, key:string, value:string) {
  if (!value || looksLikeId(value)) return { value };
  const spec = refSpec(key); if (!spec) return { value };
  const idColumn = spec.idColumn || "id", returnColumn = spec.returnColumn || idColumn;
  const exact = spec.textColumns.map(column => `lower(coalesce(${column},''))=lower(?)`).join(" OR ");
  const fuzzy = spec.textColumns.map(column => `lower(coalesce(${column},'')) LIKE lower(?)`).join(" OR ");
  const active = spec.active ? ` AND ${spec.active}=true` : "";
  const exactArgs = spec.textColumns.map(() => value), fuzzyArgs = spec.textColumns.map(() => `%${value}%`);
  const rows = await db.prepare(`SELECT ${returnColumn} AS resolved FROM ${spec.table} WHERE organization_id=?${active} AND ((${exact}) OR (${fuzzy})) ORDER BY CASE WHEN (${exact}) THEN 0 ELSE 1 END LIMIT 3`)
    .bind(organizationId,...exactArgs,...fuzzyArgs,...exactArgs).all<{resolved:string|null}>();
  const candidates = rows.results.map(row => row.resolved).filter((item):item is string => Boolean(item));
  if (candidates.length === 1) return { value:candidates[0] };
  if (!candidates.length) return { value, issue:`Could not resolve ${key} from “${value}”.` };
  return { value, issue:`${key} “${value}” matches multiple Ledgerly records.` };
}

async function resolveBodyReferences(db:D1Database, organizationId:string, input:unknown, path="body"):Promise<{value:unknown;issues:string[]}> {
  if (Array.isArray(input)) {
    const values:unknown[]=[]; const issues:string[]=[];
    for (let i=0;i<input.length;i++){const result=await resolveBodyReferences(db,organizationId,input[i],`${path}[${i}]`);values.push(result.value);issues.push(...result.issues);}return{value:values,issues};
  }
  if (!input || typeof input !== "object") return {value:input,issues:[]};
  const out:Record<string,unknown>={},issues:string[]=[];
  for (const [key,value] of Object.entries(input as Record<string,unknown>)) {
    if (typeof value === "string" && /id$/i.test(key)) {const resolved=await resolveReference(db,organizationId,key,value);out[key]=resolved.value;if(resolved.issue)issues.push(resolved.issue);continue;}
    if (Array.isArray(value) && /ids$/i.test(key)) {const singular=key.replace(/s$/i,"");const resolvedValues=[];for(const raw of value){if(typeof raw!=="string"){resolvedValues.push(raw);continue;}const resolved=await resolveReference(db,organizationId,singular,raw);resolvedValues.push(resolved.value);if(resolved.issue)issues.push(resolved.issue);}out[key]=resolvedValues;continue;}
    const nested=await resolveBodyReferences(db,organizationId,value,`${path}.${key}`);out[key]=nested.value;issues.push(...nested.issues);
  }
  return{value:out,issues};
}

function scopeFor(path:string){const p=path.toLowerCase();if(p.includes("/accounts"))return"accounts:write";if(p.includes("/journals"))return"journals:write";if(p.includes("/reports"))return"reports:write";if(p.includes("/contacts"))return"contacts:write";if(p.includes("/documents")||p.includes("/files"))return"documents:write";if(p.includes("/payments")||p.includes("/banking"))return"payments:write";if(p.includes("/payroll"))return"payroll:write";if(p.includes("/communications"))return"communications:write";if(p.includes("/products")||p.includes("/inventory"))return"products:write";return"school:write";}
function tinyHash(value:string){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}

async function prepareRouteAction(input:LightRunInput, tool:LightToolDescriptor, path:string, body:unknown, title:string, summary:string) {
  const method = tool.method || "POST";
  const payload={agentKey:input.agent.key,method,path,body};
  const key=`conversation:${input.conversationId}:light:${method}:${path}:${tinyHash(JSON.stringify(body))}`;
  const id=createId("aea");
  await input.db.prepare(`INSERT INTO ae_actions(id,organization_id,agent_key,action_type,title,summary,required_scope,payload_json,idempotency_key,status)
    VALUES(?,?,?,?,?,?,?,?,?,'suggested') ON CONFLICT(organization_id,idempotency_key) DO NOTHING`)
    .bind(id,input.principal.organizationId,input.agent.key,"system.api.request",title.slice(0,240),summary.slice(0,600),scopeFor(path),JSON.stringify(payload),key).run();
  const action=await input.db.prepare("SELECT id,status,title,action_type AS actionType,required_scope AS requiredScope FROM ae_actions WHERE organization_id=? AND idempotency_key=?").bind(input.principal.organizationId,key).first();
  return{prepared:true,executed:false,requiresHumanApproval:true,approvalSurface:"chat",action};
}

async function extractArguments(input:LightRunInput,runtime:Runtime,tool:LightToolDescriptor,prompt:string) {
  const schema = tool.source === "native" ? JSON.stringify(tool.parameters || {type:"object",properties:{}}).slice(0,6000) : routeInputHint(tool.pathTemplate || "",tool.method || "GET");
  const instruction = tool.source === "native"
    ? `Extract arguments for native tool ${tool.name}. JSON schema: ${schema}`
    : `Extract arguments for Ledgerly route tool ${tool.name}. Method/path: ${tool.method} ${tool.pathTemplate}. ${schema}\nReturn pathParams, query and body. Use human-readable names in *Id fields rather than inventing IDs; Ledgerly will resolve them.`;
  const result=await cheapJson<RouteArguments>(runtime,`${instruction}\n\nUser request: ${prompt}\nReturn {"pathParams":{},"query":{},"body":{},"title":"...","summary":"..."}.`,{},520);
  return result.value;
}

async function executeLightTool(input:LightRunInput,runtime:Runtime,tool:LightToolDescriptor,prompt:string,events:Array<Record<string,unknown>>) {
  const args=await stage(input,`light_extract_${tool.module.replace(/\s+/g,"_")}`,()=>extractArguments(input,runtime,tool,prompt));
  const logId=createId("aat");
  await input.db.prepare(`INSERT INTO ae_tool_calls(id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status) VALUES (?,?,?,?,?,?,?,'running')`)
    .bind(logId,input.principal.organizationId,input.conversationId,input.agent.key,input.principal.userId,tool.name,JSON.stringify(args)).run();
  try{
    let result:unknown;
    if(tool.source==="native"){
      result=await executeTool({db:input.db,env:input.env,principal:input.principal,agent:input.agent,conversationId:input.conversationId,requestedTools:null},tool.nativeName || tool.name,args);
    }else{
      if(!input.env.AGENT_SYSTEM_GATEWAY)throw new Error("Ledgerly Light requires the self-hosted system gateway");
      const built=fillPath(tool.pathTemplate || "",args.pathParams||{});if(built.missing.length)throw new Error(`Missing route value: ${built.missing.join(", ")}`);
      const path=appendQuery(built.path,args.query||{});
      const resolved=await resolveBodyReferences(input.db,input.principal.organizationId,args.body||{});
      if(resolved.issues.length)result={needsClarification:true,issues:resolved.issues,tool:tool.name};
      else if(tool.readOnly){const response=await input.env.AGENT_SYSTEM_GATEWAY.request({agentKey:input.agent.key,principal:input.principal,method:tool.method||"GET",path,body:tool.method==="GET"?undefined:resolved.value});if(!response.ok)throw new Error(`Ledgerly API ${response.status}: ${JSON.stringify(response.data).slice(0,1600)}`);result=response.data;}
      else result=await prepareRouteAction(input,tool,path,resolved.value,args.title||`${tool.kind} ${tool.group}`,args.summary||`Prepared from: ${prompt}`);
    }
    await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(JSON.stringify(result).slice(0,20000),logId,input.principal.organizationId).run();
    events.push({id:logId,tool:tool.name,status:"succeeded"});
    return{tool,result};
  }catch(error){const message=error instanceof Error?error.message:String(error);await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(message,logId,input.principal.organizationId).run();events.push({id:logId,tool:tool.name,status:"failed",error:message});return{tool,result:{error:message}};}
}

function requestedFormat(prompt:string):"pdf"|"xlsx"|"pptx"|"docx"|null{const v=prompt.toLowerCase();if(/\bpdf\b/.test(v))return"pdf";if(/\b(excel|xlsx|spreadsheet|workbook)\b/.test(v))return"xlsx";if(/\b(powerpoint|pptx|presentation|slides?)\b/.test(v))return"pptx";if(/\b(word|docx|document)\b/.test(v))return"docx";return null;}

async function prepareRequestedDocument(input:LightRunInput,runtime:Runtime,prompt:string,format:"pdf"|"xlsx"|"pptx"|"docx",results:unknown[],events:Array<Record<string,unknown>>){
  const source=JSON.stringify(results).slice(0,18000);
  const specResult=await stage(input,"light_build_document",()=>cheapJson<Record<string,unknown>>(runtime,`Create a compact professional document specification from VERIFIED Ledgerly tool results only. Never invent figures. User request: ${prompt}\nVerified results: ${source}\nUse this JSON shape when useful: {"subtitle":"","summary":"","dataAsOf":"","sources":[],"sections":[{"heading":"","paragraphs":[],"bullets":[],"tables":[{"title":"","headers":[],"rows":[]}],"charts":[{"title":"","type":"bar","labels":[],"series":[{"name":"","values":[]}]}]}],"tables":[],"charts":[],"sheets":[{"name":"Data","rows":[]}],"slides":[{"title":"","bullets":[],"tables":[],"charts":[]}],"notes":[]}. Default white background and black/dark text.`,{},1400));
  const titleResult=await cheapJson<{title?:string}>(runtime,`Give a short professional title for this requested ${format.toUpperCase()} file: ${prompt}\nReturn {"title":"..."}.`,{title:"Ledgerly report"},120);
  const args={title:String(titleResult.value.title||"Ledgerly report").slice(0,180),format,contentJson:JSON.stringify(specResult.value)};
  const logId=createId("aat");
  await input.db.prepare(`INSERT INTO ae_tool_calls(id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status) VALUES (?,?,?,?,?,?,?,'running')`).bind(logId,input.principal.organizationId,input.conversationId,input.agent.key,input.principal.userId,"prepare_document",JSON.stringify(args)).run();
  try{const result=await executeTool({db:input.db,env:input.env,principal:input.principal,agent:input.agent,conversationId:input.conversationId,requestedTools:null},"prepare_document",args);await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(JSON.stringify(result),logId,input.principal.organizationId).run();events.push({id:logId,tool:"prepare_document",status:"succeeded"});return result;}catch(error){const message=error instanceof Error?error.message:String(error);await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(message,logId,input.principal.organizationId).run();events.push({id:logId,tool:"prepare_document",status:"failed",error:message});throw error;}
}

export async function runLightAgent(input:LightRunInput):Promise<LightResult>{
  const prompt=latestUser(input);if(!prompt)throw new AppError(422,"VALIDATION_ERROR","A user message is required");
  const runtime=await resolveRuntimeProvider(input.db,input.env,input.principal.organizationId,"luna");
  const registry=await stage(input,"light_build_registry",()=>buildLightToolRegistry(input.env,input.principal,input.agent));
  const fallbackKinds=inferKinds(prompt);
  const kindResult=await stage(input,"light_route_type",()=>cheapJson<{types?:unknown}>(runtime,`Classify the Ledgerly request into one or more task types from: ${KINDS.join(", ")}. Select only necessary types. Request: ${prompt}\nReturn {"types":[...]}.`,{types:fallbackKinds},180));
  const kinds=validKinds(kindResult.value.types,fallbackKinds);
  let candidates=toolsForKind(registry,kinds);
  if(!candidates.length)candidates=registry.tools;
  const availableModules=[...new Set(candidates.map(tool=>tool.module))].sort();
  const moduleResult=await stage(input,"light_route_module",()=>cheapJson<{modules?:unknown}>(runtime,`Choose the Ledgerly modules needed for this request. Available modules: ${availableModules.join(", ")}. Request: ${prompt}\nReturn {"modules":[...]}. Choose up to 6.`,{modules:availableModules.slice(0,1)},220));
  let modules=validSelections(moduleResult.value.modules,availableModules,6);if(!modules.length)modules=availableModules.slice(0,1);
  candidates=toolsForModules(candidates,modules);if(!candidates.length)candidates=toolsForModules(registry.tools,modules);

  let narrowed=candidates;
  if(narrowed.length>42){
    const groups=[...new Set(narrowed.map(tool=>tool.group))].sort();
    const groupResult=await stage(input,"light_route_group",()=>cheapJson<{groups?:unknown}>(runtime,`Choose the most relevant subgroups for: ${prompt}\nAvailable subgroups: ${groups.join(", ")}\nReturn {"groups":[...]}. Choose up to 5.`,{groups:groups.slice(0,2)},220));
    const picked=validSelections(groupResult.value.groups,groups,5);if(picked.length){const byGroup=toolsForGroups(narrowed,picked);if(byGroup.length)narrowed=byGroup;}
  }
  narrowed=shortlist(prompt,narrowed,36);
  const selectionResult=await stage(input,"light_route_tool",()=>cheapJson<{tools?:unknown}>(runtime,`Choose the exact Ledgerly tools needed to complete the request. Prefer the fewest tools that fully cover it. Writes will become approval cards, never execute immediately. Request: ${prompt}\nCandidates: ${JSON.stringify(formatToolList(narrowed))}\nReturn {"tools":["exact_name",...]}. Choose at most 6.`,{tools:narrowed.slice(0,1).map(tool=>tool.name)},520));
  const selectedNames=validSelections(selectionResult.value.tools,narrowed.map(tool=>tool.name),6);
  const selected=(selectedNames.length?selectedNames:[narrowed[0]?.name]).filter(Boolean).map(name=>narrowed.find(tool=>tool.name===name)!).filter(Boolean);
  const events:Array<Record<string,unknown>>=[];const executed=[];
  for(const tool of selected)executed.push(await executeLightTool(input,runtime,tool,prompt,events));
  const results=executed.map(item=>({tool:item.tool.name,module:item.tool.module,kind:item.tool.kind,result:item.result}));
  const clarification=results.flatMap(item=>{const value=item.result as any;return value?.needsClarification&&Array.isArray(value.issues)?value.issues:[]});
  if(clarification.length)return{text:`I need one detail before I can safely continue: ${[...new Set(clarification)].join(" ")}`,model:runtime.model,provider:runtime.provider,providerResponseId:null,usage:null,toolEvents:events,routing:{kinds,modules,selected:selected.map(t=>t.name),registry:registry.stats}};
  const format=requestedFormat(prompt);
  if(format){await prepareRequestedDocument(input,runtime,prompt,format,results,events);return{text:`I prepared the ${format.toUpperCase()} output from the verified Ledgerly results. Review the document approval in this chat; you can edit it before approving and generating the file.`,model:runtime.model,provider:runtime.provider,providerResponseId:null,usage:null,toolEvents:events,routing:{kinds,modules,selected:selected.map(t=>t.name),registry:registry.stats}};}
  const prepared=results.filter(item=>{const value=item.result as any;return Boolean(value?.prepared&&value?.requiresHumanApproval)});
  if(prepared.length)return{text:prepared.length===1?"I prepared the requested Ledgerly action. Review or edit the approval card below, then approve it when ready.":`I prepared ${prepared.length} Ledgerly actions. Review or edit the approval cards below before approving them.`,model:runtime.model,provider:runtime.provider,providerResponseId:null,usage:null,toolEvents:events,routing:{kinds,modules,selected:selected.map(t=>t.name),registry:registry.stats}};
  const answer=await stage(input,"light_write_answer",()=>cheapText(runtime,`Answer the user's request using ONLY the verified Ledgerly results below. Be concise but complete. Use a markdown table when exact comparison is useful. Never invent missing values.\nUser request: ${prompt}\nVerified results: ${JSON.stringify(results).slice(0,22000)}`,900));
  return{text:answer.text||"I completed the Ledgerly lookup but could not format the final answer.",model:runtime.model,provider:runtime.provider,providerResponseId:answer.id,usage:answer.usage,toolEvents:events,routing:{kinds,modules,selected:selected.map(t=>t.name),registry:registry.stats}};
}
