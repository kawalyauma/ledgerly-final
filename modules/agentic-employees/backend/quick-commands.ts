import type { AuthPrincipal,Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { AgentDefinition } from "./policy";
import { executeTool } from "./memory-tools-v17";
import { lookupSystemSchema,type SchemaField } from "./system-schemas";
import { resolveLightReferences } from "./light-reference-resolver";
import type { LightToolDescriptor,LightToolRegistry } from "./light-tool-registry";

export type QuickFieldControl="text"|"textarea"|"date"|"number"|"boolean"|"enum"|"reference"|"json"|"array";
export type QuickCommandField={
  name:string;
  requestKey:string;
  label:string;
  control:QuickFieldControl;
  required:boolean;
  location:"path"|"body"|"native"|"meta";
  enum?:string[];
  notes?:string;
  referenceKey?:string;
  min?:number;
  max?:number;
  integer?:boolean;
  defaultValue?:unknown;
};
export type QuickCommandDescriptor={
  toolName:string;
  command:string;
  aliases:string[];
  description:string;
  module:string;
  group:string;
  kind:string;
  source:"route"|"native";
  readOnly:boolean;
  method?:string;
  pathTemplate?:string;
  schemaCoverage:"curated"|"native"|"generic";
  fields:QuickCommandField[];
};

type RefSpec={table:string;valueColumn:string;searchColumns:string[];labelColumns:string[];subtitleColumns:string[];activeColumn?:string};
const REF_SPECS:Record<string,RefSpec>={
  campusid:{table:"school_branches",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  academicyearid:{table:"school_academic_years",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"]},
  currentacademicyearid:{table:"school_academic_years",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"]},
  termid:{table:"school_terms",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"]},
  classlevelid:{table:"school_class_levels",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  admissionclasslevelid:{table:"school_class_levels",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  promotionlevelid:{table:"school_class_levels",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  targetclasslevelid:{table:"school_class_levels",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  classid:{table:"school_classes",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  currentclassid:{table:"school_classes",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  streamid:{table:"school_streams",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  currentstreamid:{table:"school_streams",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  subjectid:{table:"school_subjects",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  departmentid:{table:"school_departments",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  parentid:{table:"school_departments",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  positionid:{table:"school_staff_positions",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  gradingscaleid:{table:"school_grading_scales",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  feecategoryid:{table:"school_fee_categories",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  paymentmethodid:{table:"school_payment_methods",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"],activeColumn:"active"},
  studentid:{table:"school_students",valueColumn:"id",searchColumns:["admission_number","student_number","first_name","middle_name","last_name"],labelColumns:["first_name","middle_name","last_name"],subtitleColumns:["admission_number","student_number"]},
  guardianid:{table:"school_guardians",valueColumn:"id",searchColumns:["first_name","middle_name","last_name","phone_primary","email"],labelColumns:["first_name","middle_name","last_name"],subtitleColumns:["phone_primary","email"],activeColumn:"active"},
  staffid:{table:"school_staff_profiles",valueColumn:"id",searchColumns:["staff_number","first_name","middle_name","last_name","preferred_name"],labelColumns:["first_name","middle_name","last_name"],subtitleColumns:["staff_number","preferred_name"]},
  teacheruserid:{table:"school_staff_profiles",valueColumn:"user_id",searchColumns:["staff_number","first_name","middle_name","last_name","preferred_name"],labelColumns:["first_name","middle_name","last_name"],subtitleColumns:["staff_number","preferred_name"]},
  classteacheruserid:{table:"school_staff_profiles",valueColumn:"user_id",searchColumns:["staff_number","first_name","middle_name","last_name","preferred_name"],labelColumns:["first_name","middle_name","last_name"],subtitleColumns:["staff_number","preferred_name"]},
  headuserid:{table:"school_staff_profiles",valueColumn:"user_id",searchColumns:["staff_number","first_name","middle_name","last_name","preferred_name"],labelColumns:["first_name","middle_name","last_name"],subtitleColumns:["staff_number","preferred_name"]},
  assigneeuserid:{table:"school_staff_profiles",valueColumn:"user_id",searchColumns:["staff_number","first_name","middle_name","last_name","preferred_name"],labelColumns:["first_name","middle_name","last_name"],subtitleColumns:["staff_number","preferred_name"]},
  accountid:{table:"accounts",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"]},
  incomeaccountid:{table:"accounts",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"]},
  receivableaccountid:{table:"accounts",valueColumn:"id",searchColumns:["code","name"],labelColumns:["name"],subtitleColumns:["code"]},
  productid:{table:"products",valueColumn:"id",searchColumns:["sku","name"],labelColumns:["name"],subtitleColumns:["sku"]},
  contactid:{table:"contacts",valueColumn:"id",searchColumns:["code","name","email"],labelColumns:["name"],subtitleColumns:["code","email"]},
};

const ACTION_TERMS=new Set(["approve","reject","publish","apply","execute","reverse","void","close","reopen","archive","restore","promote","transfer","assign","unassign","send","submit","activate","deactivate","finalize","post","allocate","reconcile","reschedule","substitute"]);
const NOUN_OVERRIDES:Record<string,string>={
  classlevels:"class level",academicyears:"academic year",feecategories:"fee category",paymentmethods:"payment method",
  students:"student",guardians:"guardian",staff:"staff member",positions:"staff position",classes:"class",streams:"stream",subjects:"subject",
  departments:"department",terms:"term",accounts:"account",journals:"journal",contacts:"contact",products:"product",documents:"document",
};
const PATH_REFERENCE:Record<string,string>={
  students:"studentId",guardians:"guardianId",staff:"staffId",classes:"classId",classlevels:"classLevelId",streams:"streamId",subjects:"subjectId",
  academicyears:"academicYearId",terms:"termId",departments:"departmentId",positions:"positionId",accounts:"accountId",contacts:"contactId",products:"productId",
};

function normalize(value:string){return value.toLowerCase().replace(/[^a-z0-9]/g,"");}
function human(value:string){return value.replace(/^route_/,"").replace(/[_-]+/g," ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/\s+/g," ").trim();}
function title(value:string){return human(value).replace(/\b\w/g,x=>x.toUpperCase());}
function singular(value:string){const n=normalize(value);if(NOUN_OVERRIDES[n])return NOUN_OVERRIDES[n];const v=human(value).toLowerCase();if(v.endsWith("ies"))return `${v.slice(0,-3)}y`;if(v.endsWith("sses"))return v.slice(0,-2);if(v.endsWith("s")&&!v.endsWith("ss"))return v.slice(0,-1);return v;}
function pathStatic(path:string){return path.split("?")[0]!.split("/").filter(Boolean).slice(2).filter(x=>!x.startsWith(":"));}
function entityFor(tool:LightToolDescriptor){
  const promoted=tool.name.match(/^(?:create|list|get|update|delete|report|search|prepare|open)_([a-z0-9_]+)$/);
  if(promoted)return singular(promoted[1]!.replace(/_/g," "));
  const parts=pathStatic(tool.pathTemplate||"").filter(x=>!["school","setup","student-management","staff-management","api","v1"].includes(x.toLowerCase()));
  let last=parts.at(-1)||tool.group||tool.module||"item";
  if(ACTION_TERMS.has(last.toLowerCase())&&parts.length>1)last=parts[parts.length-2]!;
  return singular(last);
}
function verbsFor(kind:string){
  if(kind==="create")return["create","add","new","register","make","set up","setup","start"];
  if(kind==="query")return["open","view","show","find","search","list","get","check","lookup","browse","inspect","see"];
  if(kind==="update")return["update","edit","change","modify","revise","set","adjust","rename"];
  if(kind==="delete")return["delete","remove","drop","erase","delete selected","remove selected"];
  if(kind==="report")return["report","show report","view report","open report","generate report","prepare report","analyse","analyze"];
  if(kind==="communication")return["send","message","communicate","notify","prepare message","send message","contact"];
  if(kind==="document")return["document","create document","generate document","prepare document","make document","export","print"];
  if(kind==="analysis")return["analyze","analyse","compare","review","inspect","explain","summarize"];
  return["run","perform","execute","apply","start","open"];
}
function aliasesFor(tool:LightToolDescriptor){
  const entity=entityFor(tool),values=new Set<string>();
  const canonical=human(tool.name).replace(/^(route|get|list) /,"").trim();
  values.add(canonical);for(const a of tool.aliases||[])values.add(human(a));
  for(const verb of verbsFor(tool.kind))values.add(`${verb} ${entity}`);
  if(tool.kind==="create"){values.add(`add new ${entity}`);values.add(`create new ${entity}`);}
  if(tool.kind==="query"){values.add(`open ${entity} record`);values.add(`search ${entity} records`);}
  return[...values].map(v=>v.toLowerCase().replace(/\s+/g," ").trim()).filter(v=>v.length>1&&v.length<100).slice(0,18);
}
function canonicalFor(tool:LightToolDescriptor){const entity=entityFor(tool);const verb=tool.kind==="query"?"open":tool.kind==="report"?"report":tool.kind==="analysis"?"analyze":tool.kind==="communication"?"send":tool.kind==="document"?"document":tool.kind==="action"?"run":tool.kind;return `${verb} ${entity}`.trim();}

function referenceKey(name:string){
  const key=normalize(name);if(REF_SPECS[key])return name;
  if(key==="classid"||key==="currentclassid")return name;
  return undefined;
}
function controlFor(name:string,type:string,enumValues?:string[]):QuickFieldControl{
  if(enumValues?.length)return"enum";if(referenceKey(name))return"reference";const t=type.toLowerCase();
  if(t.includes("boolean"))return"boolean";if(t.includes("date"))return"date";if(t.includes("integer")||t.includes("number"))return"number";if(t.includes("array"))return"array";if(t.includes("object")||t.includes("json"))return"json";if(t.includes("text")||t.includes("description")||t.includes("content"))return"textarea";return"text";
}
function fieldFromSchema(field:SchemaField,requiredOverride?:boolean):QuickCommandField{
  const key=referenceKey(field.name),control=controlFor(field.name,field.type,field.enum);
  const range=field.type.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  return{name:field.name,requestKey:field.name,label:title(field.name),control,required:requiredOverride??field.required,location:"body",enum:field.enum,notes:field.notes,referenceKey:key,min:range?Number(range[1]):undefined,max:range?Number(range[2]):undefined,integer:/integer/i.test(field.type),defaultValue:["admissionDate","hireDate"].includes(field.name)?"$today":undefined};
}
function collectionSchema(path:string){
  const clean=path.split("?")[0]!.replace(/\/$/,"");
  return lookupSystemSchema(clean)||lookupSystemSchema(clean.replace(/\/:([A-Za-z0-9_]+)$/,""))||null;
}
function pathFields(tool:LightToolDescriptor):QuickCommandField[]{
  const path=tool.pathTemplate||"",parts=path.split("?")[0]!.split("/").filter(Boolean),out:QuickCommandField[]=[];
  for(let i=0;i<parts.length;i++){const part=parts[i]!;if(!part.startsWith(":"))continue;const requestKey=part.slice(1),prev=normalize(parts[i-1]||""),inferred=requestKey.toLowerCase().endsWith("id")?requestKey:(PATH_REFERENCE[prev]||`${singular(parts[i-1]||"record").replace(/\s+(.)/g,(_,x)=>x.toUpperCase())}Id`),ref=referenceKey(inferred);
    out.push({name:inferred,requestKey,label:title(inferred.replace(/Id$/,"")),control:ref?"reference":"text",required:true,location:"path",referenceKey:ref,notes:`Select the ${singular(parts[i-1]||"record")} to use.`});}
  return out;
}
function nativeFields(tool:LightToolDescriptor):QuickCommandField[]{
  const params=(tool.parameters||{}) as any,props=(params.properties||{}) as Record<string,any>,required=new Set<string>(Array.isArray(params.required)?params.required.map(String):[]);
  return Object.entries(props).map(([name,spec])=>{const type=String(spec?.type||"string"),enumValues=Array.isArray(spec?.enum)?spec.enum.map(String):undefined,key=referenceKey(name);return{name,requestKey:name,label:title(name),control:controlFor(name,type,enumValues),required:required.has(name),location:"native",enum:enumValues,notes:String(spec?.description||""),referenceKey:key,min:Number.isFinite(spec?.minimum)?Number(spec.minimum):undefined,max:Number.isFinite(spec?.maximum)?Number(spec.maximum):undefined,integer:type==="integer"};});
}
function fieldsFor(tool:LightToolDescriptor){
  if(tool.source==="native")return{fields:nativeFields(tool),coverage:"native" as const};
  const fields=pathFields(tool),schema=collectionSchema(tool.pathTemplate||"");
  if(schema){if(["POST","PUT","PATCH"].includes(tool.method||"")){const requiredOverride=tool.method==="POST"?undefined:false;for(const field of schema.fields){if(fields.some(x=>x.name===field.name))continue;fields.push(fieldFromSchema(field,requiredOverride));}}return{fields,coverage:"curated" as const};}
  if(!tool.readOnly)fields.push({name:"bodyJson",requestKey:"bodyJson",label:"Additional Details (JSON)",control:"json",required:false,location:"meta",notes:"Optional JSON body for routes that do not yet have a curated form schema."});
  return{fields,coverage:"generic" as const};
}

export function buildQuickCommandCatalog(registry:LightToolRegistry){
  const commands:QuickCommandDescriptor[]=registry.tools.map(tool=>{const built=fieldsFor(tool),aliases=aliasesFor(tool),command=canonicalFor(tool);if(!aliases.includes(command))aliases.unshift(command);return{toolName:tool.name,command,aliases,description:tool.description,module:tool.module,group:tool.group,kind:tool.kind,source:tool.source,readOnly:tool.readOnly,method:tool.method,pathTemplate:tool.pathTemplate,schemaCoverage:built.coverage,fields:built.fields};});
  const commandCount=commands.reduce((sum,item)=>sum+item.aliases.length,0);
  return{commands,stats:{toolCount:registry.stats.total,commandCount,routeTools:registry.stats.routeTools,nativeTools:registry.stats.nativeTools,writes:registry.stats.writes,reads:registry.stats.reads}};
}

function cleanText(value:unknown){return value===undefined||value===null?"":String(value).trim();}
function displayValue(row:Record<string,unknown>,cols:string[]){return cols.map(c=>cleanText(row[c])).filter(Boolean).join(" ").replace(/\s+/g," ").trim();}
export async function searchQuickReferenceOptions(db:D1Database,organizationId:string,field:string,q:string,limit=20){
  const spec=REF_SPECS[normalize(field)];if(!spec)throw new AppError(422,"REFERENCE_UNSUPPORTED",`No searchable reference is configured for ${field}`);
  const selected=[spec.valueColumn,...new Set([...spec.searchColumns,...spec.labelColumns,...spec.subtitleColumns])],safeLimit=Math.max(1,Math.min(30,Math.floor(limit)||20)),where=[`organization_id=?`],args:any[]=[organizationId];
  if(spec.activeColumn)where.push(`${spec.activeColumn}=true`);
  const query=q.trim();if(query){where.push(`(${spec.searchColumns.map(c=>`lower(coalesce(${c},'')) LIKE lower(?)`).join(" OR ")})`);for(let i=0;i<spec.searchColumns.length;i++)args.push(`%${query}%`);}
  args.push(safeLimit);
  const rows=await db.prepare(`SELECT ${selected.join(",")} FROM ${spec.table} WHERE ${where.join(" AND ")} ORDER BY ${spec.labelColumns[0]||spec.searchColumns[0]} LIMIT ?`).bind(...args).all<Record<string,unknown>>();
  return rows.results.map(row=>({value:cleanText(row[spec.valueColumn]),label:displayValue(row,spec.labelColumns)||displayValue(row,spec.searchColumns)||cleanText(row[spec.valueColumn]),subtitle:displayValue(row,spec.subtitleColumns)})).filter(x=>x.value);
}

function fillPath(template:string,params:Record<string,unknown>){
  const missing:string[]=[];const path=template.replace(/:([A-Za-z0-9_]+)/g,(_m,key)=>{const value=params[key];if(value===undefined||value===null||String(value).trim()===""){missing.push(key);return`:${key}`;}return encodeURIComponent(String(value));});return{path,missing};
}
function scopeFor(path:string){const p=path.toLowerCase();if(p.includes("/accounts"))return"accounts:write";if(p.includes("/journals"))return"journals:write";if(p.includes("/contacts"))return"contacts:write";if(p.includes("/documents")||p.includes("/files"))return"documents:write";if(p.includes("/payments")||p.includes("/banking"))return"payments:write";if(p.includes("/payroll"))return"payroll:write";if(p.includes("/communications"))return"communications:write";if(p.includes("/inventory")||p.includes("/products"))return"products:write";return"school:write";}
function hashText(value:string){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}
function codeFromName(value:string,fallback:string){return value.replace(/[^A-Za-z0-9]+/g,"").toUpperCase().slice(0,40)||fallback;}
function defaults(tool:LightToolDescriptor,body:Record<string,unknown>){
  const path=tool.pathTemplate||"",method=tool.method;if(method==="POST"&&path==="/api/v1/school/setup/classes"){if(typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"CLASS");if(typeof body.name==="string"&&!body.classLevelId)body.classLevelId=body.name;}
  if(method==="POST"&&path==="/api/v1/school/setup/classLevels"){if(typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"LEVEL");if(typeof body.name==="string"&&body.sequenceNo===undefined){const m=body.name.match(/(\d{1,3})/);if(m)body.sequenceNo=Number(m[1]);}}
  if(method==="POST"&&path==="/api/v1/school/setup/streams"&&typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"STREAM");
  if(method==="POST"&&path==="/api/v1/school/setup/subjects"&&typeof body.name==="string"&&!body.code)body.code=codeFromName(body.name,"SUBJECT");
  if(method==="POST"&&path==="/api/v1/school/setup/terms"&&typeof body.name==="string"&&body.sequenceNo===undefined){const m=body.name.match(/(\d{1,2})/);if(m)body.sequenceNo=Number(m[1]);}
  if(method==="POST"&&path==="/api/v1/school/student-management/students"&&!body.admissionDate)body.admissionDate=new Date().toISOString().slice(0,10);
  if(method==="POST"&&path==="/api/v1/school/staff-management/staff"&&!body.hireDate)body.hireDate=new Date().toISOString().slice(0,10);
  return body;
}
function coerce(field:QuickCommandField,raw:unknown){
  if(raw===undefined||raw===null||raw==="")return undefined;if(field.control==="boolean")return raw===true||String(raw)==="true";if(field.control==="number"){const n=Number(raw);return Number.isFinite(n)?n:raw;}if(field.control==="array")return Array.isArray(raw)?raw:String(raw).split(",").map(x=>x.trim()).filter(Boolean);if(field.control==="json"&&typeof raw==="string"){try{return JSON.parse(raw);}catch{return raw;}}return raw;
}
function validateField(field:QuickCommandField,value:unknown){
  const issues:string[]=[];if(field.required&&(value===undefined||value===null||String(value).trim()===""))issues.push(`${field.label} is required`);if(value===undefined||value===null||value==="")return issues;
  if(field.enum?.length&&!field.enum.includes(String(value)))issues.push(`${field.label} must be one of: ${field.enum.join(", ")}`);
  if(field.control==="date"&&!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))issues.push(`${field.label} must use YYYY-MM-DD`);
  if(field.control==="number"){const n=Number(value);if(!Number.isFinite(n))issues.push(`${field.label} must be a number`);else{if(field.integer&&!Number.isInteger(n))issues.push(`${field.label} must be a whole number`);if(field.min!==undefined&&n<field.min)issues.push(`${field.label} must be at least ${field.min}`);if(field.max!==undefined&&n>field.max)issues.push(`${field.label} must be at most ${field.max}`);}}
  if(field.control==="json"&&typeof value==="string"){try{JSON.parse(value);}catch{issues.push(`${field.label} must be valid JSON`);}}return issues;
}
function validateResolved(tool:LightToolDescriptor,body:Record<string,unknown>){
  const schema=collectionSchema(tool.pathTemplate||"");if(!schema)return[];const issues:string[]=[];for(const field of schema.fields){const value=body[field.name],required=tool.method==="POST"&&schema.method==="POST"&&field.required;if(required&&(value===undefined||value===null||String(value).trim()===""))issues.push(`${field.name} is required`);if(field.enum?.length&&value!==undefined&&value!==null&&!field.enum.includes(String(value)))issues.push(`${field.name} must be one of: ${field.enum.join(", ")}`);}return issues;
}
function markdown(data:any){
  const root=data?.data??data?.results??data;if(Array.isArray(root)&&root.length){const rows=root.slice(0,25).filter(x=>x&&typeof x==="object"&&!Array.isArray(x));if(rows.length){const keys=[...new Set(rows.flatMap((r:any)=>Object.keys(r).filter(k=>["string","number","boolean"].includes(typeof r[k])||r[k]===null)))].slice(0,8);if(keys.length){const cell=(v:any)=>String(v??"").replace(/\|/g,"\\|").replace(/\n/g," ");return`| ${keys.map(title).join(" | ")} |\n| ${keys.map(()=>"---").join(" | ")} |\n${rows.map((r:any)=>`| ${keys.map(k=>cell(r[k])).join(" | ")} |`).join("\n")}`;}}}
  if(root&&typeof root==="object")return`\n\n${Object.entries(root).slice(0,30).map(([k,v])=>`- **${title(k)}:** ${typeof v==="object"?JSON.stringify(v):String(v??"")}`).join("\n")}`;return String(root??"No data returned.");
}
async function recordQuickMessages(db:D1Database,principal:AuthPrincipal,conversationId:string,commandText:string,assistantText:string){
  const userId=createId("aam"),assistantId=createId("aam"),now=new Date().toISOString();await db.batch([
    db.prepare(`INSERT INTO ae_messages(id,organization_id,conversation_id,role,content,user_id,metadata_json) VALUES(?,?,?,'user',?,?,?)`).bind(userId,principal.organizationId,conversationId,commandText,principal.userId,JSON.stringify({mode:"quick-command"})),
    db.prepare(`INSERT INTO ae_messages(id,organization_id,conversation_id,role,content,user_id,model,metadata_json) VALUES(?,?,?,'assistant',?,?,?,?,?)`).bind(assistantId,principal.organizationId,conversationId,assistantText,principal.userId,"quick-command",JSON.stringify({mode:"quick-command"})),
    db.prepare("UPDATE ae_conversations SET last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(conversationId,principal.organizationId),
  ]);return{userMessage:{id:userId,role:"user" as const,content:commandText,createdAt:now},assistantMessage:{id:assistantId,role:"assistant" as const,content:assistantText,model:"quick-command",createdAt:now}};
}

export async function executeQuickCommand(input:{db:D1Database;env:Env;principal:AuthPrincipal;agent:AgentDefinition;conversationId:string;registry:LightToolRegistry;toolName:string;values:Record<string,unknown>;commandText?:string}){
  const tool=input.registry.tools.find(t=>t.name===input.toolName);if(!tool)throw new AppError(404,"COMMAND_NOT_FOUND","That quick command is no longer available for this AI employee.");
  const descriptor=buildQuickCommandCatalog({ ...input.registry,tools:[tool],stats:{total:1,routeTools:tool.source==="route"?1:0,nativeTools:tool.source==="native"?1:0,writes:tool.readOnly?0:1,reads:tool.readOnly?1:0} }).commands[0]!;
  const typed:Record<string,unknown>={},issues:string[]=[];for(const field of descriptor.fields){const raw=input.values[field.name]??(field.defaultValue==="$today"?new Date().toISOString().slice(0,10):field.defaultValue),value=coerce(field,raw);issues.push(...validateField(field,value));if(value!==undefined)typed[field.name]=value;}if(issues.length)throw new AppError(422,"VALIDATION_ERROR",issues.join(". "),{fields:issues});
  const commandText=input.commandText?.trim()||`/${descriptor.command}`;
  let result:any,prepared=false;
  if(tool.source==="native"){
    const args:Record<string,unknown>={};for(const field of descriptor.fields.filter(f=>f.location==="native"))if(typed[field.name]!==undefined)args[field.requestKey]=typed[field.name];
    const resolved=await resolveLightReferences(input.db,input.principal.organizationId,args);if(resolved.issues.length)throw new AppError(422,"VALIDATION_ERROR",resolved.issues.join(" "));
    result=await executeTool({db:input.db,principal:input.principal,agent:input.agent,conversationId:input.conversationId,requestedTools:null},tool.nativeName||tool.name,resolved.value);prepared=Boolean(result?.prepared||result?.requiresHumanApproval||result?.action);
  }else{
    if(!input.env.AGENT_SYSTEM_GATEWAY)throw new AppError(503,"GATEWAY_UNAVAILABLE","Ledgerly command gateway is unavailable.");
    const pathParams:Record<string,unknown>={};for(const field of descriptor.fields.filter(f=>f.location==="path")){let value=typed[field.name];if(field.referenceKey&&typeof value==="string"){const resolved=await resolveLightReferences(input.db,input.principal.organizationId,{[field.referenceKey]:value});if(resolved.issues.length)throw new AppError(422,"VALIDATION_ERROR",resolved.issues.join(" "));value=(resolved.value as any)[field.referenceKey];}pathParams[field.requestKey]=value;}
    const filled=fillPath(tool.pathTemplate||"",pathParams);if(filled.missing.length)throw new AppError(422,"VALIDATION_ERROR",`Select ${filled.missing.join(", ")} first.`);
    const body:Record<string,unknown>={};for(const field of descriptor.fields.filter(f=>f.location==="body"))if(typed[field.name]!==undefined)body[field.requestKey]=typed[field.name];
    const bodyJson=typed.bodyJson;if(bodyJson&&typeof bodyJson==="object"&&!Array.isArray(bodyJson))Object.assign(body,bodyJson);
    const resolved=await resolveLightReferences(input.db,input.principal.organizationId,defaults(tool,body));if(resolved.issues.length)throw new AppError(422,"VALIDATION_ERROR",resolved.issues.join(" "));
    const schemaIssues=validateResolved(tool,resolved.value as Record<string,unknown>);if(schemaIssues.length)throw new AppError(422,"VALIDATION_ERROR",schemaIssues.join(". "));
    if(tool.readOnly){const response=await input.env.AGENT_SYSTEM_GATEWAY.request({agentKey:input.agent.key,principal:input.principal,method:tool.method||"GET",path:filled.path,body:tool.method==="GET"?undefined:resolved.value});if(!response.ok)throw new AppError(response.status||502,"COMMAND_FAILED",response.data?.error?.message||`Ledgerly returned HTTP ${response.status}`);result=response.data;}
    else{const method=tool.method||"POST",payload={agentKey:input.agent.key,method,path:filled.path,body:resolved.value},key=`conversation:${input.conversationId}:quick:${method}:${filled.path}:${hashText(JSON.stringify(resolved.value))}`,id=createId("aea"),actionTitle=title(descriptor.command);await input.db.prepare(`INSERT INTO ae_actions(id,organization_id,agent_key,action_type,title,summary,required_scope,payload_json,idempotency_key,status) VALUES(?,?,?,?,?,?,?,?,?,'suggested') ON CONFLICT(organization_id,idempotency_key) DO NOTHING`).bind(id,input.principal.organizationId,input.agent.key,"system.api.request",actionTitle.slice(0,240),`Quick command /${descriptor.command} validated and prepared for approval.`,scopeFor(filled.path),JSON.stringify(payload),key).run();const action=await input.db.prepare("SELECT id,status,title,action_type AS actionType,required_scope AS requiredScope FROM ae_actions WHERE organization_id=? AND idempotency_key=?").bind(input.principal.organizationId,key).first();result={prepared:true,requiresHumanApproval:true,action};prepared=true;}
  }
  const assistantText=prepared?`**Quick command validated.** I prepared **${title(descriptor.command)}** for review below. Nothing is written to Ledgerly until you approve and run it.`:`**Quick command completed: /${descriptor.command}**\n\n${markdown(result)}`;
  return{...await recordQuickMessages(input.db,input.principal,input.conversationId,commandText,assistantText),prepared,result,command:descriptor};
}
