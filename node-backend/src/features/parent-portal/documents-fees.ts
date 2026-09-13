import { Hono } from "hono";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";

function camel(row:Record<string,unknown>){const o:Record<string,unknown>={};for(const[k,v]of Object.entries(row))o[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())]=v;return o;}
function safeName(name:string){return(name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"")||"file").slice(0,180);}
async function guardian(runtime:Runtime,org:string,userId:string){const q=await runtime.db.query(`SELECT guardian_id FROM school_guardian_portal_accounts WHERE organization_id=$1 AND user_id=$2 AND active=true`,[org,userId]);if(!q.rowCount)throw new AppError(403,"PARENT_PORTAL_NOT_LINKED","This user is not linked to an active guardian portal account");return String(q.rows[0].guardian_id);}
async function child(runtime:Runtime,org:string,guardianId:string,studentId:string){const q=await runtime.db.query(`SELECT 1 FROM school_student_guardians sg JOIN school_students s ON s.id=sg.student_id AND s.organization_id=sg.organization_id WHERE sg.organization_id=$1 AND sg.guardian_id=$2 AND sg.student_id=$3 AND s.deleted_at IS NULL`,[org,guardianId,studentId]);if(!q.rowCount)throw new AppError(404,"CHILD_NOT_FOUND","Student is not linked to this guardian account");}

export function createParentPortalDocumentFeeRoutes(runtime:Runtime){
 const r=new Hono<AppEnv>();

 r.get("/children/:studentId/documents",async c=>{
  const p=c.get("principal"),studentId=c.req.param("studentId"),guardianId=await guardian(runtime,p.organizationId,p.userId);await child(runtime,p.organizationId,guardianId,studentId);
  const q=await runtime.db.query(`SELECT d.id,d.document_type,d.title,d.issued_on,d.expires_on,d.notes,d.created_at,f.id file_id,f.original_name,f.mime_type,f.size_bytes,f.checksum_sha256 FROM school_student_documents d JOIN school_files f ON f.id=d.file_id AND f.organization_id=d.organization_id WHERE d.organization_id=$1 AND d.student_id=$2 AND f.deleted_at IS NULL ORDER BY COALESCE(d.issued_on,d.created_at::date) DESC,d.created_at DESC`,[p.organizationId,studentId]);
  return c.json({data:q.rows.map((x:any)=>({...camel(x),contentUrl:`/api/v1/parent-portal/children/${studentId}/documents/${x.id}/content`}))});
 });

 r.get("/children/:studentId/documents/:documentId/content",async c=>{
  const p=c.get("principal"),studentId=c.req.param("studentId"),documentId=c.req.param("documentId"),guardianId=await guardian(runtime,p.organizationId,p.userId);await child(runtime,p.organizationId,guardianId,studentId);
  const row=(await runtime.db.query<any>(`SELECT f.object_key,f.original_name,f.mime_type,f.size_bytes FROM school_student_documents d JOIN school_files f ON f.id=d.file_id AND f.organization_id=d.organization_id WHERE d.id=$1 AND d.organization_id=$2 AND d.student_id=$3 AND f.deleted_at IS NULL`,[documentId,p.organizationId,studentId])).rows[0];
  if(!row)throw new AppError(404,"DOCUMENT_NOT_FOUND","Student document not found");const bytes=await runtime.storage.get(row.object_key);if(!bytes)throw new AppError(404,"FILE_OBJECT_MISSING","The document file is unavailable");c.header("content-type",String(row.mime_type));c.header("content-length",String(row.size_bytes));c.header("content-disposition",`inline; filename=\"${safeName(String(row.original_name))}\"`);return c.body(bytes);
 });

 r.get("/children/:studentId/receipts",async c=>{
  const p=c.get("principal"),studentId=c.req.param("studentId"),guardianId=await guardian(runtime,p.organizationId,p.userId);await child(runtime,p.organizationId,guardianId,studentId);
  const q=await runtime.db.query(`SELECT r.id,r.receipt_number,r.amount_minor::float8 amount_minor,r.payment_date,r.reference,r.created_at,pmt.id payment_id,pmt.number payment_number,pmt.currency,pmt.status payment_status FROM school_fee_receipts r JOIN payments pmt ON pmt.id=r.payment_id AND pmt.organization_id=r.organization_id WHERE r.organization_id=$1 AND r.student_id=$2 ORDER BY r.payment_date DESC,r.created_at DESC LIMIT 500`,[p.organizationId,studentId]);return c.json({data:q.rows.map(camel)});
 });

 r.get("/children/:studentId/fee-statement",async c=>{
  const p=c.get("principal"),studentId=c.req.param("studentId"),guardianId=await guardian(runtime,p.organizationId,p.userId);await child(runtime,p.organizationId,guardianId,studentId);
  const [student,invoices,receipts]=await Promise.all([
   runtime.db.query(`SELECT id,admission_number,student_number,first_name,middle_name,last_name FROM school_students WHERE id=$1 AND organization_id=$2`,[studentId,p.organizationId]),
   runtime.db.query(`SELECT DISTINCT d.id,d.number,d.issue_date,d.due_date,d.currency,d.total_minor::float8 total_minor,d.paid_minor::float8 paid_minor,(d.total_minor-d.paid_minor)::float8 balance_minor,d.status FROM school_student_fee_charges ch JOIN documents d ON d.id=ch.document_id AND d.organization_id=ch.organization_id WHERE ch.organization_id=$1 AND ch.student_id=$2 AND d.type='invoice' AND d.status<>'void' ORDER BY d.issue_date,d.number`,[p.organizationId,studentId]),
   runtime.db.query(`SELECT r.id,r.receipt_number,r.amount_minor::float8 amount_minor,r.payment_date,r.reference,p.status payment_status,p.currency FROM school_fee_receipts r JOIN payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND r.student_id=$2 ORDER BY r.payment_date,r.created_at`,[p.organizationId,studentId])
  ]);
  const billed=invoices.rows.reduce((n:number,x:any)=>n+Number(x.total_minor||0),0),paid=invoices.rows.reduce((n:number,x:any)=>n+Number(x.paid_minor||0),0);return c.json({data:{student:camel(student.rows[0]??{}),summary:{billedMinor:billed,paidMinor:paid,balanceMinor:billed-paid},invoices:invoices.rows.map(camel),receipts:receipts.rows.map(camel)}});
 });
 return r;
}
