import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
import { createDocument, postDocument } from "../documents/service.js";

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bulk=z.object({structureId:z.string(),issueDate:date,dueDate:date.nullable().optional(),controlAccountId:z.string().optional(),classId:z.string().nullable().optional(),streamId:z.string().nullable().optional(),studentIds:z.array(z.string()).max(1000).optional(),force:z.boolean().default(false)});
function amount(x:unknown){return Math.max(0,Number(x??0));}
function awardDiscount(base:number,a:any){if(a.calculation_type==='fixed')return amount(a.amount_minor);return Math.floor(base*amount(a.rate_micros)/100_000_000);}

async function pricedLines(runtime:Runtime,org:string,studentId:string,structure:any,issueDate:string){
 const lines=(await runtime.db.query<any>(`SELECT l.*,fc.name category_name,fc.income_account_id FROM school_fee_structure_lines l JOIN school_fee_categories fc ON fc.id=l.fee_category_id AND fc.organization_id=l.organization_id WHERE l.organization_id=$1 AND l.structure_id=$2 AND fc.active=true ORDER BY fc.name,l.id`,[org,structure.id])).rows;
 if(!lines.length)throw new AppError(409,'EMPTY_FEE_STRUCTURE','Fee structure has no active fee lines');
 const awards=(await runtime.db.query<any>(`SELECT * FROM school_fee_awards WHERE organization_id=$1 AND student_id=$2 AND active=true AND (academic_year_id IS NULL OR academic_year_id=$3) AND (term_id IS NULL OR term_id=$4) AND (starts_on IS NULL OR starts_on<=$5::date) AND (ends_on IS NULL OR ends_on>=$5::date) ORDER BY fee_category_id NULLS LAST,created_at`,[org,studentId,structure.academic_year_id,structure.term_id,issueDate])).rows;
 let globalFixed=awards.filter((a:any)=>!a.fee_category_id&&a.calculation_type==='fixed').reduce((n:number,a:any)=>n+amount(a.amount_minor),0);
 return lines.map((l:any)=>{
   const gross=amount(l.amount_minor);
   let discount=0;
   for(const a of awards){if(a.fee_category_id&&String(a.fee_category_id)!==String(l.fee_category_id))continue;if(!a.fee_category_id&&a.calculation_type==='fixed')continue;discount+=awardDiscount(gross,a);}
   if(globalFixed>0){const use=Math.min(globalFixed,Math.max(0,gross-discount));discount+=use;globalFixed-=use;}
   discount=Math.min(gross,discount);
   return{...l,grossMinor:gross,discountMinor:discount,netMinor:gross-discount};
 });
}

export function createSchoolFeeOperationRoutes(runtime:Runtime){const r=new Hono<AppEnv>();r.use('*',requireScope('school:read'));
 r.post('/billing/bulk',requireScope('school:write'),async c=>{
   const parsed=bulk.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','Invalid mass billing request',parsed.error.flatten());
   const p=c.get('principal'),v=parsed.data,structure=(await runtime.db.query<any>(`SELECT * FROM school_fee_structures WHERE id=$1 AND organization_id=$2 AND status='active'`,[v.structureId,p.organizationId])).rows[0];if(!structure)throw new AppError(404,'FEE_STRUCTURE_NOT_FOUND','Active fee structure not found');
   const params:any[]=[p.organizationId];let where=`s.organization_id=$1 AND s.deleted_at IS NULL AND s.status='active' AND s.contact_id IS NOT NULL`;
   if(v.classId){params.push(v.classId);where+=` AND s.current_class_id=$${params.length}`;}if(v.streamId){params.push(v.streamId);where+=` AND s.current_stream_id=$${params.length}`;}if(v.studentIds?.length){params.push(v.studentIds);where+=` AND s.id=ANY($${params.length}::text[])`;}
   if(structure.class_id){params.push(structure.class_id);where+=` AND s.current_class_id=$${params.length}`;}if(structure.stream_id){params.push(structure.stream_id);where+=` AND s.current_stream_id=$${params.length}`;}if(structure.residency_status){params.push(structure.residency_status);where+=` AND s.residency_status=$${params.length}`;}if(structure.student_category){params.push(structure.student_category);where+=` AND s.student_category=$${params.length}`;}
   const students=(await runtime.db.query<any>(`SELECT id,contact_id,current_class_id,current_stream_id,admission_number,first_name,last_name FROM school_students s WHERE ${where} ORDER BY last_name,first_name`,params)).rows;
   const results:any[]=[];
   for(const student of students){
     if(!v.force){const prior=await runtime.db.query(`SELECT 1 FROM school_student_fee_charges ch JOIN documents d ON d.id=ch.document_id AND d.organization_id=ch.organization_id WHERE ch.organization_id=$1 AND ch.student_id=$2 AND ch.structure_id=$3 AND d.status<>'reversed' LIMIT 1`,[p.organizationId,student.id,v.structureId]);if(prior.rowCount){results.push({studentId:student.id,status:'skipped',reason:'already_billed'});continue;}}
     try{
       const lines=await pricedLines(runtime,p.organizationId,student.id,structure,v.issueDate),net=lines.filter((x:any)=>x.netMinor>0);if(!net.length){results.push({studentId:student.id,status:'skipped',reason:'fully_waived'});continue;}
       const number=`FEE-${v.issueDate.replaceAll('-','')}-${createId('n').slice(-8).toUpperCase()}`;
       const doc=await createDocument(runtime,p.organizationId,p.userId,{type:'invoice',number,contactId:String(student.contact_id),issueDate:v.issueDate,dueDate:v.dueDate??v.issueDate,currency:String(structure.currency),customFields:{schoolStudentId:student.id,schoolFeeStructureId:v.structureId,massBilling:true},lines:net.map((x:any)=>({accountId:String(x.income_account_id),description:String(x.description??x.category_name),quantityMicros:1_000_000,unitPriceMinor:x.netMinor,taxMinor:0,classId:student.current_class_id??undefined,dimensions:{schoolStudentId:student.id,schoolFeeCategoryId:String(x.fee_category_id),grossMinor:x.grossMinor,discountMinor:x.discountMinor}}))});
       await postDocument(runtime,p.organizationId,p.userId,doc.id,v.controlAccountId);
       for(const x of lines)await runtime.db.query(`INSERT INTO school_student_fee_charges(id,organization_id,student_id,structure_id,structure_line_id,document_id,fee_category_id,amount_minor,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[createId('chg'),p.organizationId,student.id,v.structureId,x.id,doc.id,x.fee_category_id,x.netMinor,x.due_date??v.dueDate??v.issueDate,p.userId]);
       results.push({studentId:student.id,status:'billed',documentId:doc.id,number,totalMinor:doc.totalMinor,discountMinor:lines.reduce((n:number,x:any)=>n+x.discountMinor,0)});
     }catch(e:any){results.push({studentId:student.id,status:'failed',code:String(e?.code??'BILLING_FAILED'),message:String(e?.message??'Billing failed')});}
   }
   const billed=results.filter(x=>x.status==='billed').length,failed=results.filter(x=>x.status==='failed').length,skipped=results.length-billed-failed;return c.json({data:{structureId:v.structureId,total:results.length,billed,failed,skipped,results}},failed?207:201);
 });

 r.post('/installment-plans/:id/reconcile',requireScope('school:write'),async c=>{const p=c.get('principal'),id=c.req.param('id'),plan=(await runtime.db.query<any>(`SELECT document_id,status FROM school_fee_installment_plans WHERE id=$1 AND organization_id=$2`,[id,p.organizationId])).rows[0];if(!plan)throw new AppError(404,'PLAN_NOT_FOUND','Installment plan not found');if(plan.status==='cancelled')throw new AppError(409,'PLAN_CANCELLED','Cancelled installment plans cannot be reconciled');await runtime.db.query(`SELECT ledgerly_recompute_school_fee_installments($1,$2)`,[p.organizationId,plan.document_id]);const items=await runtime.db.query(`SELECT *,(amount_minor-paid_minor)::float8 balance_minor FROM school_fee_installments WHERE organization_id=$1 AND plan_id=$2 ORDER BY sequence`,[p.organizationId,id]);const current=(await runtime.db.query(`SELECT * FROM school_fee_installment_plans WHERE id=$1 AND organization_id=$2`,[id,p.organizationId])).rows[0];return c.json({data:{...current,installments:items.rows}});});

 r.get('/installments/due',async c=>{const p=c.get('principal'),days=Math.min(Math.max(Number(c.req.query('days')??30),0),365),q=await runtime.db.query(`SELECT i.*,pl.student_id,pl.document_id,pl.name plan_name,s.admission_number,concat_ws(' ',s.first_name,s.last_name) student_name,d.number document_number FROM school_fee_installments i JOIN school_fee_installment_plans pl ON pl.id=i.plan_id AND pl.organization_id=i.organization_id JOIN school_students s ON s.id=pl.student_id JOIN documents d ON d.id=pl.document_id WHERE i.organization_id=$1 AND pl.status='active' AND i.status IN ('pending','partially_paid','overdue') AND i.due_date<=CURRENT_DATE+$2::int ORDER BY i.due_date,s.last_name,s.first_name`,[p.organizationId,days]);return c.json({data:q.rows});});
 return r;}
