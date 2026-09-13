import { Hono } from "hono";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";

function camel(row:Record<string,unknown>){const out:Record<string,unknown>={};for(const[k,v]of Object.entries(row))out[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())]=v;return out;}
function safeName(name:string){return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"")||"file";}

async function guardian(runtime:Runtime,org:string,userId:string){
 const q=await runtime.db.query(`SELECT a.guardian_id FROM school_guardian_portal_accounts a JOIN school_guardians g ON g.id=a.guardian_id AND g.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.user_id=$2 AND a.active=true AND g.deleted_at IS NULL`,[org,userId]);
 if(!q.rowCount)throw new AppError(403,"PARENT_PORTAL_NOT_LINKED","This user is not linked to an active guardian portal account");
 return String(q.rows[0].guardian_id);
}
async function requireChild(runtime:Runtime,org:string,guardianId:string,studentId:string){
 const q=await runtime.db.query(`SELECT s.id,s.current_academic_year_id,s.current_class_id,s.current_stream_id FROM school_student_guardians sg JOIN school_students s ON s.id=sg.student_id AND s.organization_id=sg.organization_id WHERE sg.organization_id=$1 AND sg.guardian_id=$2 AND sg.student_id=$3 AND sg.deleted_at IS NULL AND s.deleted_at IS NULL`,[org,guardianId,studentId]);
 if(!q.rowCount)throw new AppError(404,"CHILD_NOT_FOUND","Student is not linked to this guardian account");
 return q.rows[0] as any;
}

export function createParentPortalAcademicRoutes(runtime:Runtime){
 const r=new Hono<AppEnv>();

 r.get("/children/:studentId/results",async c=>{
  const p=c.get("principal"),studentId=c.req.param("studentId"),gid=await guardian(runtime,p.organizationId,p.userId);await requireChild(runtime,p.organizationId,gid,studentId);
  const cards=await runtime.db.query(`SELECT rc.*,e.name exam_name,e.exam_type,e.start_date,e.end_date,t.name term_name,ay.name academic_year_name,cl.name class_name,st.name stream_name FROM exm_report_cards rc JOIN exm_exams e ON e.id=rc.exam_id AND e.organization_id=rc.organization_id LEFT JOIN school_terms t ON t.id=e.term_id LEFT JOIN school_academic_years ay ON ay.id=e.academic_year_id JOIN school_classes cl ON cl.id=rc.class_id LEFT JOIN school_streams st ON st.id=rc.stream_id WHERE rc.organization_id=$1 AND rc.student_id=$2 AND rc.published_at IS NOT NULL ORDER BY COALESCE(e.end_date,e.start_date) DESC NULLS LAST,rc.published_at DESC`,[p.organizationId,studentId]);
  const data=[];for(const card of cards.rows as any[]){const subjects=await runtime.db.query(`SELECT subject_id,subject_name,mark,max_mark,percentage,grade,points,counted_for_aggregate,remarks FROM exm_report_subjects WHERE organization_id=$1 AND report_card_id=$2 ORDER BY subject_name`,[p.organizationId,card.id]);data.push({...camel(card),subjects:subjects.rows.map(camel)});}return c.json({data});
 });

 r.get("/children/:studentId/timetable",async c=>{
  const p=c.get("principal"),studentId=c.req.param("studentId"),gid=await guardian(runtime,p.organizationId,p.userId),child=await requireChild(runtime,p.organizationId,gid,studentId);
  if(!child.current_class_id)return c.json({data:[]});
  const q=await runtime.db.query(`SELECT e.id,e.weekday,e.starts_at,e.ends_at,e.notes,su.code subject_code,su.name subject_name,concat_ws(' ',sp.first_name,sp.last_name) teacher_name,rm.name room_name,t.id timetable_id,t.name timetable_name,tr.name term_name,ay.name academic_year_name FROM school_academic_timetable_entries e JOIN school_academic_timetables t ON t.id=e.timetable_id AND t.organization_id=e.organization_id JOIN school_subjects su ON su.id=e.subject_id JOIN school_staff_profiles sp ON sp.id=e.teacher_staff_id LEFT JOIN school_academic_rooms rm ON rm.id=e.room_id LEFT JOIN school_terms tr ON tr.id=t.term_id LEFT JOIN school_academic_years ay ON ay.id=t.academic_year_id WHERE e.organization_id=$1 AND t.status='published' AND e.class_id=$2 AND ($3::text IS NULL OR e.stream_id IS NULL OR e.stream_id=$3) AND ($4::text IS NULL OR t.academic_year_id=$4) ORDER BY e.weekday,e.starts_at,su.name`,[p.organizationId,child.current_class_id,child.current_stream_id??null,child.current_academic_year_id??null]);
  return c.json({data:q.rows.map(camel)});
 });

 r.get("/children/:studentId/documents",async c=>{
  const p=c.get("principal"),studentId=c.req.param("studentId"),gid=await guardian(runtime,p.organizationId,p.userId);await requireChild(runtime,p.organizationId,gid,studentId);
  const q=await runtime.db.query(`SELECT d.id,d.document_type,d.title,d.issued_on,d.expires_on,d.notes,d.created_at,f.id file_id,f.original_name,f.mime_type,f.size_bytes FROM school_student_documents d JOIN school_files f ON f.id=d.file_id AND f.organization_id=d.organization_id WHERE d.organization_id=$1 AND d.student_id=$2 AND f.deleted_at IS NULL ORDER BY d.created_at DESC`,[p.organizationId,studentId]);
  return c.json({data:q.rows.map((x:any)=>({...camel(x),contentUrl:`/api/v1/parent-portal/children/${studentId}/documents/${x.id}/content`}))});
 });

 r.get("/children/:studentId/documents/:documentId/content",async c=>{
  const p=c.get("principal"),studentId=c.req.param("studentId"),gid=await guardian(runtime,p.organizationId,p.userId);await requireChild(runtime,p.organizationId,gid,studentId);
  const q=await runtime.db.query(`SELECT f.object_key,f.original_name,f.mime_type,f.size_bytes FROM school_student_documents d JOIN school_files f ON f.id=d.file_id AND f.organization_id=d.organization_id WHERE d.id=$1 AND d.organization_id=$2 AND d.student_id=$3 AND f.deleted_at IS NULL`,[c.req.param("documentId"),p.organizationId,studentId]);
  if(!q.rowCount)throw new AppError(404,"DOCUMENT_NOT_FOUND","Student document not found");const file=q.rows[0] as any,bytes=await runtime.storage.get(String(file.object_key));if(!bytes)throw new AppError(404,"FILE_OBJECT_MISSING","The document file is unavailable");c.header("Content-Type",String(file.mime_type));c.header("Content-Length",String(file.size_bytes));c.header("Content-Disposition",`inline; filename=\"${safeName(String(file.original_name))}\"`);return c.body(bytes);
 });
 return r;
}
