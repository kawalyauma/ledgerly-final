import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";

const key = z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/);
const label = z.string().trim().min(1).max(240);
const option = z.string().trim().min(1).max(160);
const entityTypes = ["teacher", "class", "subject", "student"] as const;
const columnType = z.enum(["text", "textarea", "number", "date", "select", ...entityTypes]);
const columnSchema = z.object({
  id: key, label, type: columnType, required: z.boolean().default(false),
  options: z.array(option).max(100).optional(),
});
const fieldSchema = z.object({
  id: key,
  label,
  type: z.enum(["text", "textarea", "number", "date", "time", "select", "multi_select", ...entityTypes, "rubric", "table"]),
  required: z.boolean().default(false),
  helpText: z.string().trim().max(1000).optional(),
  placeholder: z.string().trim().max(240).optional(),
  options: z.array(option).max(100).optional(),
  items: z.array(option).max(100).optional(),
  scale: z.enum(["compliance", "rating4", "rating5"]).optional(),
  columns: z.array(columnSchema).max(20).optional(),
}).superRefine((field,ctx)=>{
  if((field.type==="select"||field.type==="multi_select")&&!field.options?.length)ctx.addIssue({code:"custom",message:"Dropdown fields need at least one option",path:["options"]});
  if(field.type==="rubric"&&!field.items?.length)ctx.addIssue({code:"custom",message:"Rubrics need at least one item",path:["items"]});
  if(field.type==="table"&&!field.columns?.length)ctx.addIssue({code:"custom",message:"Repeating tables need at least one column",path:["columns"]});
});
const sectionSchema = z.object({
  id: key, title: label, description: z.string().trim().max(1200).optional(), fields: z.array(fieldSchema).min(1).max(50),
});
export const supervisionTemplateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).default(""),
  active: z.boolean().default(true),
  sections: z.array(sectionSchema).min(1).max(20),
  version: z.number().int().positive().optional(),
}).superRefine((value,ctx)=>{
  const ids=new Set<string>();
  for(const [si,section] of value.sections.entries())for(const [fi,field] of section.fields.entries()){
    if(ids.has(field.id))ctx.addIssue({code:"custom",message:`Field key '${field.id}' is used more than once`,path:["sections",si,"fields",fi,"id"]});
    ids.add(field.id);
    if(field.columns){const columns=new Set<string>();for(const [ci,column] of field.columns.entries()){
      if(columns.has(column.id))ctx.addIssue({code:"custom",message:`Column key '${column.id}' is used more than once`,path:["sections",si,"fields",fi,"columns",ci,"id"]});
      columns.add(column.id);
    }}
  }
});

const reviewSchema = z.object({
  templateId: z.string().min(1), title: z.string().trim().max(240).default(""), observedOn: z.iso.date(),
  status: z.enum(["draft","completed","follow_up","closed"]).default("draft"),
  answers: z.record(z.string(),z.unknown()).default({}), version: z.number().int().positive().optional(),
});

type Field = z.infer<typeof fieldSchema>;
type Section = z.infer<typeof sectionSchema>;
type EntityType = typeof entityTypes[number];
const tables:Record<EntityType,string>={teacher:"school_staff_profiles",class:"school_classes",subject:"school_subjects",student:"school_students"};

function empty(value:unknown){
  if(value===undefined||value===null||value==="")return true;
  if(Array.isArray(value))return value.length===0;
  if(typeof value==="object")return Object.keys(value as object).length===0;
  return false;
}

function validateScalar(field:Pick<Field,"type"|"options">,value:unknown,path:string,errors:Record<string,string[]>,entities:Map<EntityType,Set<string>>){
  const fail=(message:string)=>(errors[path]??=[]).push(message);
  if(value===undefined||value===null||value==="")return;
  if(field.type==="number"&&(typeof value!=="number"||!Number.isFinite(value)))return fail("Enter a valid number");
  if(field.type==="date"&&(typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)))return fail("Enter a valid date");
  if(field.type==="time"&&(typeof value!=="string"||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)))return fail("Enter a valid time");
  if(field.type==="select"&&(typeof value!=="string"||!field.options?.includes(value)))return fail("Choose one of the configured options");
  if(field.type==="multi_select"&&(!Array.isArray(value)||value.some(x=>typeof x!=="string"||!field.options?.includes(x))))return fail("Choose only configured options");
  if((entityTypes as readonly string[]).includes(field.type)){
    if(typeof value!=="string")return fail("Choose a valid record");
    entities.get(field.type as EntityType)?.add(value);
  }
}

function validateAnswers(sections:Section[],answers:Record<string,unknown>,complete:boolean){
  const errors:Record<string,string[]>={},entities=new Map<EntityType,Set<string>>(entityTypes.map(t=>[t,new Set()]));
  for(const section of sections)for(const field of section.fields){
    const value=answers[field.id],path=`answers.${field.id}`;
    if(complete&&field.required&&empty(value)){(errors[path]??=[]).push("This field is required");continue;}
    if(field.type==="rubric"&&!empty(value)){
      if(!value||Array.isArray(value)||typeof value!=="object"){(errors[path]??=[]).push("Invalid rubric response");continue;}
      const rubric=value as Record<string,unknown>,allowed=field.scale==="rating5"?[1,2,3,4,5,"NO"]:field.scale==="rating4"?[1,2,3,4,"NO"]:["C","P","NC","NA"];
      for(const [index] of (field.items??[]).entries()){
        const row=rubric[String(index)] as {value?:unknown;note?:unknown}|undefined;
        if(complete&&field.required&&empty(row?.value))(errors[`${path}.${index}`]??=[]).push("Choose a rating");
        else if(row?.value!==undefined&&!allowed.includes(row.value as never))(errors[`${path}.${index}`]??=[]).push("Invalid rating");
      }
      continue;
    }
    if(field.type==="table"&&!empty(value)){
      if(!Array.isArray(value)||(value as unknown[]).length>100){(errors[path]??=[]).push("Invalid table response");continue;}
      (value as unknown[]).forEach((row,ri)=>{
        if(!row||Array.isArray(row)||typeof row!=="object"){(errors[`${path}.${ri}`]??=[]).push("Invalid row");return;}
        for(const column of field.columns??[]){const cell=(row as Record<string,unknown>)[column.id],cellPath=`${path}.${ri}.${column.id}`;
          if(complete&&column.required&&empty(cell))(errors[cellPath]??=[]).push("This cell is required");
          else validateScalar(column as Field,cell,cellPath,errors,entities);
        }
      });
      continue;
    }
    validateScalar(field,value,path,errors,entities);
  }
  if(Object.keys(errors).length)throw new AppError(422,"VALIDATION_ERROR","Check the supervision form",{fieldErrors:errors});
  return entities;
}

async function validateEntities(runtime:Runtime,org:string,entities:Map<EntityType,Set<string>>){
  for(const type of entityTypes)for(const id of entities.get(type)??[]){
    const extra=type==="student"?" AND deleted_at IS NULL":type==="teacher"?" AND is_teacher=true":"";
    if(!(await runtime.db.query(`SELECT 1 FROM ${tables[type]} WHERE id=$1 AND organization_id=$2${extra}`,[id,org])).rowCount)
      throw new AppError(422,"INVALID_REFERENCE",`A selected ${type} does not belong to this school`);
  }
}

function primaryEntity(sections:Section[],answers:Record<string,unknown>){
  for(const type of entityTypes)for(const section of sections)for(const field of section.fields){
    if(field.type===type&&typeof answers[field.id]==="string"&&answers[field.id])return{type,id:String(answers[field.id])};
  }
  return null;
}

function templateDto(row:any){return{id:row.id,name:row.name,description:row.description??"",sections:row.schema_json,active:row.active,isDefault:row.is_default,version:row.version,reviewCount:Number(row.review_count??0),updatedAt:row.updated_at};}
function reviewDto(row:any){return{id:row.id,templateId:row.template_id,templateName:row.template_name,templateVersion:row.template_version,title:row.title??"",observedOn:String(row.observed_on).slice(0,10),status:row.status,primaryEntityType:row.primary_entity_type,primaryEntityId:row.primary_entity_id,answers:row.answers_json,sections:row.template_snapshot,version:row.version,updatedAt:row.updated_at};}

export function createSupervisionComplianceRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();r.use("*",requireScope("school:read"));

  r.get("/supervision/templates",async c=>{
    const p=c.get("principal"),q=await runtime.db.query(`SELECT t.*,(SELECT COUNT(*) FROM school_supervision_reviews r WHERE r.template_id=t.id AND r.organization_id=t.organization_id)::int review_count FROM school_supervision_templates t WHERE t.organization_id=$1 ORDER BY t.active DESC,t.is_default DESC,t.updated_at DESC`,[p.organizationId]);
    return c.json({data:q.rows.map(templateDto)});
  });

  r.post("/supervision/templates",requireScope("school:write"),async c=>{
    const parsed=supervisionTemplateSchema.safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Check the form template",parsed.error.flatten());
    const p=c.get("principal"),v=parsed.data,id=createId("sft");
    try{await runtime.db.query(`INSERT INTO school_supervision_templates(id,organization_id,name,description,schema_json,active,created_by,updated_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$7)`,[id,p.organizationId,v.name,v.description,JSON.stringify(v.sections),v.active,p.userId]);}
    catch(error:any){if(error?.code==="23505")throw new AppError(409,"TEMPLATE_NAME_EXISTS","A supervision form already uses this name");throw error;}
    return c.json({data:{id,...v,version:1,reviewCount:0}},201);
  });

  r.put("/supervision/templates/:id",requireScope("school:write"),async c=>{
    const parsed=supervisionTemplateSchema.safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Check the form template",parsed.error.flatten());
    const p=c.get("principal"),v=parsed.data,id=c.req.param("id");
    try{const q=await runtime.db.query(`UPDATE school_supervision_templates SET name=$1,description=$2,schema_json=$3::jsonb,active=$4,updated_by=$5,updated_at=now(),version=version+1 WHERE id=$6 AND organization_id=$7 AND version=$8 RETURNING version`,[v.name,v.description,JSON.stringify(v.sections),v.active,p.userId,id,p.organizationId,v.version??0]);
      if(!q.rowCount)throw new AppError(409,"TEMPLATE_CONFLICT","This template changed or is unavailable. Reload before saving.");
      return c.json({data:{id,...v,version:q.rows[0].version}});
    }catch(error:any){if(error?.code==="23505")throw new AppError(409,"TEMPLATE_NAME_EXISTS","A supervision form already uses this name");throw error;}
  });

  r.get("/supervision/reviews",async c=>{
    const p=c.get("principal"),templateId=c.req.query("templateId")??null;
    const q=await runtime.db.query(`SELECT r.*,t.name template_name FROM school_supervision_reviews r JOIN school_supervision_templates t ON t.id=r.template_id AND t.organization_id=r.organization_id WHERE r.organization_id=$1 AND ($2::text IS NULL OR r.template_id=$2) ORDER BY r.observed_on DESC,r.created_at DESC LIMIT 500`,[p.organizationId,templateId]);
    return c.json({data:q.rows.map(reviewDto)});
  });

  async function saveReview(c:any,id?:string){
    const parsed=reviewSchema.safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Check the supervision form",parsed.error.flatten());
    const p=c.get("principal"),v=parsed.data;
    let templateVersion:number,sections:Section[];
    if(id){const existing=(await runtime.db.query(`SELECT template_id,template_version,template_snapshot FROM school_supervision_reviews WHERE id=$1 AND organization_id=$2`,[id,p.organizationId])).rows[0];
      if(!existing)throw new AppError(404,"REVIEW_NOT_FOUND","Supervision record not found");
      if(existing.template_id!==v.templateId)throw new AppError(422,"TEMPLATE_CHANGE_NOT_ALLOWED","A saved supervision record cannot change templates");
      templateVersion=Number(existing.template_version);sections=existing.template_snapshot as Section[];
    }else{const template=(await runtime.db.query(`SELECT version,schema_json FROM school_supervision_templates WHERE id=$1 AND organization_id=$2 AND active=true`,[v.templateId,p.organizationId])).rows[0];
      if(!template)throw new AppError(422,"INVALID_TEMPLATE","Choose an active supervision form");
      templateVersion=Number(template.version);sections=template.schema_json as Section[];
    }
    const complete=v.status!=="draft",entities=validateAnswers(sections,v.answers,complete);await validateEntities(runtime,p.organizationId,entities);
    const primary=primaryEntity(sections,v.answers),recordId=id??createId("srv");
    if(id){const q=await runtime.db.query(`UPDATE school_supervision_reviews SET title=$1,observed_on=$2,status=$3,primary_entity_type=$4,primary_entity_id=$5,answers_json=$6::jsonb,completed_at=CASE WHEN $3='draft' THEN NULL ELSE COALESCE(completed_at,now()) END,updated_by=$7,updated_at=now(),version=version+1 WHERE id=$8 AND organization_id=$9 AND version=$10 RETURNING version`,[v.title,v.observedOn,v.status,primary?.type??null,primary?.id??null,JSON.stringify(v.answers),p.userId,id,p.organizationId,v.version??0]);
      if(!q.rowCount)throw new AppError(409,"REVIEW_CONFLICT","This supervision record changed or is unavailable. Reload before saving.");
      return c.json({data:{id,...v,sections,templateVersion,version:q.rows[0].version}});
    }
    await runtime.db.query(`INSERT INTO school_supervision_reviews(id,organization_id,template_id,template_version,title,observed_on,status,primary_entity_type,primary_entity_id,answers_json,template_snapshot,completed_at,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,CASE WHEN $7='draft' THEN NULL ELSE now() END,$12,$12)`,[recordId,p.organizationId,v.templateId,templateVersion,v.title,v.observedOn,v.status,primary?.type??null,primary?.id??null,JSON.stringify(v.answers),JSON.stringify(sections),p.userId]);
    return c.json({data:{id:recordId,...v,sections,templateVersion,version:1}},201);
  }

  r.post("/supervision/reviews",requireScope("school:write"),c=>saveReview(c));
  r.put("/supervision/reviews/:id",requireScope("school:write"),c=>saveReview(c,c.req.param("id")));
  return r;
}
