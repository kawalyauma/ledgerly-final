import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
import { createDocument, postDocument } from "../documents/service.js";

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const request=z.object({studentId:z.string(),structureId:z.string(),issueDate:date,dueDate:date.nullable().optional(),controlAccountId:z.string().optional(),force:z.boolean().default(false)});
const amount=(x:unknown)=>Math.max(0,Number(x??0));
function awardDiscount(base:number,a:any){return a.calculation_type==='fixed'?amount(a.amount_minor):Math.floor(base*amount(a.rate_micros)/100_000_000);}

async function pricing(runtime:Runtime,org:string,studentId:string,structure:any,issueDate:string){
  const lines=(await runtime.db.query<any>(`SELECT l.*,fc.name category_name,fc.income_account_id FROM school_fee_structure_lines l JOIN school_fee_categories fc ON fc.id=l.fee_category_id AND fc.organization_id=l.organization_id WHERE l.organization_id=$1 AND l.structure_id=$2 AND fc.active=true ORDER BY fc.name,l.id`,[org,structure.id])).rows;
  if(!lines.length)throw new AppError(409,'EMPTY_FEE_STRUCTURE','Fee structure has no active fee lines');
  const awards=(await runtime.db.query<any>(`SELECT * FROM school_fee_awards WHERE organization_id=$1 AND student_id=$2 AND active=true AND (academic_year_id IS NULL OR academic_year_id=$3) AND (term_id IS NULL OR term_id=$4) AND (starts_on IS NULL OR starts_on<=$5::date) AND (ends_on IS NULL OR ends_on>=$5::date) ORDER BY fee_category_id NULLS LAST,created_at,id`,[org,studentId,structure.academic_year_id,structure.term_id,issueDate])).rows;
  let globalFixed=awards.filter((a:any)=>!a.fee_category_id&&a.calculation_type==='fixed').reduce((n:number,a:any)=>n+amount(a.amount_minor),0);
  const priced=lines.map((l:any)=>{
    const gross=amount(l.amount_minor);let discount=0;
    for(const a of awards){if(a.fee_category_id&&String(a.fee_category_id)!==String(l.fee_category_id))continue;if(!a.fee_category_id&&a.calculation_type==='fixed')continue;discount+=awardDiscount(gross,a);}
    if(globalFixed>0){const used=Math.min(globalFixed,Math.max(0,gross-discount));discount+=used;globalFixed-=used;}
    discount=Math.min(gross,discount);
    return{...l,grossMinor:gross,discountMinor:discount,netMinor:gross-discount};
  });
  return{lines:priced,awards};
}

export function createSchoolFeeBillingIntegrityRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();r.use('*',requireScope('school:read'));
  r.post('/billing/preview',async c=>{const parsed=request.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','Invalid billing preview',parsed.error.flatten());const p=c.get('principal'),v=parsed.data,student=(await runtime.db.query<any>(`SELECT id,current_class_id,current_stream_id,residency_status,student_category FROM school_students WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,[v.studentId,p.organizationId])).rows[0];if(!student)throw new AppError(404,'STUDENT_NOT_FOUND','Student not found');const structure=(await runtime.db.query<any>(`SELECT * FROM school_fee_structures WHERE id=$1 AND organization_id=$2 AND status='active'`,[v.structureId,p.organizationId])).rows[0];if(!structure)throw new AppError(404,'FEE_STRUCTURE_NOT_FOUND','Active fee structure not found');const priced=await pricing(runtime,p.organizationId,v.studentId,structure,v.issueDate);const gross=priced.lines.reduce((n:number,x:any)=>n+x.grossMinor,0),discount=priced.lines.reduce((n:number,x:any)=>n+x.discountMinor,0),net=priced.lines.reduce((n:number,x:any)=>n+x.netMinor,0);return c.json({data:{studentId:v.studentId,structureId:v.structureId,grossMinor:gross,discountMinor:discount,totalMinor:net,awards:priced.awards.map((a:any)=>({id:a.id,awardType:a.award_type,calculationType:a.calculation_type,amountMinor:a.amount_minor,rateMicros:a.rate_micros,feeCategoryId:a.fee_category_id})),lines:priced.lines.map((x:any)=>({structureLineId:x.id,feeCategoryId:x.fee_category_id,description:x.description??x.category_name,grossMinor:x.grossMinor,discountMinor:x.discountMinor,totalMinor:x.netMinor,dueDate:x.due_date??v.dueDate??v.issueDate}))}});});

  r.post('/billing',requireScope('school:write'),async c=>{const parsed=request.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,'VALIDATION_ERROR','Invalid student billing request',parsed.error.flatten());const p=c.get('principal'),v=parsed.data,student=(await runtime.db.query<any>(`SELECT id,contact_id,current_class_id,current_stream_id,residency_status,student_category FROM school_students WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,[v.studentId,p.organizationId])).rows[0];if(!student?.contact_id)throw new AppError(422,'STUDENT_CONTACT_REQUIRED','Student must have a finance contact before billing');const structure=(await runtime.db.query<any>(`SELECT * FROM school_fee_structures WHERE id=$1 AND organization_id=$2 AND status='active'`,[v.structureId,p.organizationId])).rows[0];if(!structure)throw new AppError(404,'FEE_STRUCTURE_NOT_FOUND','Active fee structure not found');if(!v.force){const prior=await runtime.db.query(`SELECT 1 FROM school_student_fee_charges ch JOIN documents d ON d.id=ch.document_id AND d.organization_id=ch.organization_id WHERE ch.organization_id=$1 AND ch.student_id=$2 AND ch.structure_id=$3 AND d.status<>'reversed' LIMIT 1`,[p.organizationId,v.studentId,v.structureId]);if(prior.rowCount)throw new AppError(409,'ALREADY_BILLED','Student has already been billed from this fee structure');}
    const priced=await pricing(runtime,p.organizationId,v.studentId,structure,v.issueDate),net=priced.lines.filter((x:any)=>x.netMinor>0);if(!net.length)return c.json({data:{studentId:v.studentId,structureId:v.structureId,status:'fully_waived',totalMinor:0,discountMinor:priced.lines.reduce((n:number,x:any)=>n+x.discountMinor,0)}});
    const number=`FEE-${v.issueDate.replaceAll('-','')}-${createId('n').slice(-8).toUpperCase()}`,doc=await createDocument(runtime,p.organizationId,p.userId,{type:'invoice',number,contactId:String(student.contact_id),issueDate:v.issueDate,dueDate:v.dueDate??v.issueDate,currency:String(structure.currency),customFields:{schoolStudentId:v.studentId,schoolFeeStructureId:v.structureId},lines:net.map((x:any)=>({accountId:String(x.income_account_id),description:String(x.description??x.category_name),quantityMicros:1_000_000,unitPriceMinor:x.netMinor,taxMinor:0,classId:student.current_class_id??undefined,dimensions:{schoolStudentId:v.studentId,schoolFeeCategoryId:String(x.fee_category_id),grossMinor:x.grossMinor,discountMinor:x.discountMinor}}))});await postDocument(runtime,p.organizationId,p.userId,doc.id,v.controlAccountId);
    for(const x of priced.lines)await runtime.db.query(`INSERT INTO school_student_fee_charges(id,organization_id,student_id,structure_id,structure_line_id,document_id,fee_category_id,amount_minor,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[createId('chg'),p.organizationId,v.studentId,v.structureId,x.id,doc.id,x.fee_category_id,x.netMinor,x.due_date??v.dueDate??v.issueDate,p.userId]);
    const discount=priced.lines.reduce((n:number,x:any)=>n+x.discountMinor,0);await runtime.db.query(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'school.fees.student_billed','school_student',$4,$5::jsonb)`,[createId('aud'),p.organizationId,p.userId,v.studentId,JSON.stringify({documentId:doc.id,structureId:v.structureId,totalMinor:doc.totalMinor,discountMinor:discount})]);return c.json({data:{studentId:v.studentId,documentId:doc.id,number,totalMinor:doc.totalMinor,discountMinor:discount,status:'open'}},201);
  });
  return r;
}
