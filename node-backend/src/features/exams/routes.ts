import { Hono } from "hono";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";

function camel(r:Record<string,unknown>){const o:Record<string,unknown>={};for(const[k,v]of Object.entries(r))o[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())]=v;return o;}
async function owned(rt:Runtime,org:string,t:string,id?:string|null){if(!id)return;const q=await rt.db.query(`SELECT 1 FROM ${t} WHERE id=$1 AND organization_id=$2`,[id,org]);if(!q.rowCount)throw new AppError(422,"INVALID_REFERENCE","Referenced record does not belong to this school");}

export function createExamRoutes(runtime:Runtime){const r=new Hono<AppEnv>();r.use("*",requireScope("school:read"));
 r.get("/manifest",c=>c.json({data:{key:"exams",name:"Examinations",version:"1.0.0"}}));
 r.get("/overview",async c=>{const p=c.get("principal"),q=await runtime.db.query(`SELECT COUNT(*)::int exams,COUNT(*) FILTER(WHERE status='marking')::int marking,COUNT(*) FILTER(WHERE status='published')::int published FROM exm_exams WHERE organization_id=$1`,[p.organizationId]);return c.json({data:camel(q.rows[0]??{})});});
 r.get("/",async c=>{const p=c.get("principal"),q=await runtime.db.query(`SELECT * FROM exm_exams WHERE organization_id=$1 ORDER BY created_at DESC`,[p.organizationId]);return c.json({data:q.rows.map(camel)});});
 r.post("/",requireScope("school:write"),async c=>{const p=c.get("principal"),b=await c.req.json().catch(()=>({})) as any;if(!b.name)throw new AppError(422,"VALIDATION_ERROR","Exam name is required");await owned(runtime,p.organizationId,"school_terms",b.termId);await owned(runtime,p.organizationId,"school_academic_years",b.academicYearId);const id=createId("exm");await runtime.db.query(`INSERT INTO exm_exams(id,organization_id,term_id,academic_year_id,name,exam_type,start_date,end_date,grading_scale_id,remarks,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,[id,p.organizationId,b.termId??null,b.academicYearId??null,String(b.name),b.examType??"end_of_term",b.startDate??null,b.endDate??null,b.gradingScaleId??null,b.remarks??null,p.userId]);return c.json({data:{id,status:"draft",...b}},201);});
 r.patch("/:examId/status",requireScope("school:write"),async c=>{const p=c.get("principal"),id=c.req.param("examId"),b=await c.req.json().catch(()=>({})) as any,status=String(b.status??"");if(!["draft","open","marking","computed","published","closed","cancelled"].includes(status))throw new AppError(422,"VALIDATION_ERROR","Invalid exam status");const q=await runtime.db.query(`UPDATE exm_exams SET status=$1,updated_by=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND organization_id=$4 RETURNING *`,[status,p.userId,id,p.organizationId]);if(!q.rowCount)throw new AppError(404,"NOT_FOUND","Exam not found");return c.json({data:camel(q.rows[0])});});
 return r;}
