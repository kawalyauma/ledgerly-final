import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";

function camel(r:Record<string,unknown>){const o:Record<string,unknown>={};for(const[k,v]of Object.entries(r))o[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())]=v;return o;}

const ENTITY_TABLES:Record<string,string>={
  scheme_lesson_plan:"school_scheme_lesson_plans",
  scheme_lesson_delivery:"school_scheme_lesson_deliveries",
  observation:"school_academic_observations",
  record_inspection:"school_academic_record_inspections",
};
const attachSchema=z.object({
  entityType:z.enum(["scheme_lesson_plan","scheme_lesson_delivery","observation","record_inspection"]),
  entityId:z.string().min(1),
  fileId:z.string().min(1),
  role:z.enum(["evidence","source_scan"]).default("evidence"),
  caption:z.string().max(500).nullable().optional(),
});

export function createAcademicAttachmentRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();
  r.use("*",requireScope("school:read"));

  r.get("/attachments",async c=>{
    const p=c.get("principal"),entityType=c.req.query("entityType"),entityId=c.req.query("entityId");
    if(!entityType||!entityId)throw new AppError(422,"VALIDATION_ERROR","entityType and entityId are required");
    const q=await runtime.db.query(
      `SELECT a.*,f.original_name file_name,f.mime_type,f.size_bytes
         FROM school_academic_attachments a JOIN school_files f ON f.id=a.file_id
        WHERE a.organization_id=$1 AND a.entity_type=$2 AND a.entity_id=$3
        ORDER BY a.created_at DESC`,
      [p.organizationId,entityType,entityId],
    );
    return c.json({data:q.rows.map(camel)});
  });

  r.post("/attachments",requireScope("school:write"),async c=>{
    const s=attachSchema.safeParse(await c.req.json().catch(()=>null));
    if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid attachment",s.error.flatten());
    const p=c.get("principal"),v=s.data;
    const table=ENTITY_TABLES[v.entityType];
    const entity=await runtime.db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2`,[v.entityId,p.organizationId]);
    if(!entity.rowCount)throw new AppError(422,"INVALID_REFERENCE",`${v.entityType} record does not belong to this school`);
    const file=await runtime.db.query(`SELECT 1 FROM school_files WHERE id=$1 AND organization_id=$2`,[v.fileId,p.organizationId]);
    if(!file.rowCount)throw new AppError(422,"INVALID_REFERENCE","File does not belong to this school");
    const id=createId("aat");
    await runtime.db.query(
      `INSERT INTO school_academic_attachments(id,organization_id,entity_type,entity_id,file_id,role,caption,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id,p.organizationId,v.entityType,v.entityId,v.fileId,v.role,v.caption??null,p.userId],
    );
    return c.json({data:{id,...v}},201);
  });

  return r;
}
