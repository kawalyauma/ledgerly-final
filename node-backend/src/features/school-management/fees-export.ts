import { Hono } from "hono";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { requireScope } from "../core-identity/security.js";

function camel(row:Record<string,unknown>){const out:Record<string,unknown>={};for(const[k,v]of Object.entries(row))out[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())]=v;return out;}
function csvCell(v:unknown){const s=v==null?"":String(v);return /[",\n\r]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
function csv(headers:string[],rows:unknown[][]){return [headers.map(csvCell).join(','),...rows.map(r=>r.map(csvCell).join(','))].join('\n')+'\n';}
function csvResponse(c:any,name:string,body:string){c.header('content-type','text/csv; charset=utf-8');c.header('content-disposition',`attachment; filename="${name}"`);return c.body(body);}

export function createSchoolFeeExportRoutes(runtime:Runtime){
 const r=new Hono<AppEnv>();r.use('*',requireScope('school:read'));

 r.get('/students/:studentId/statement',async c=>{
  const p=c.get('principal'),studentId=c.req.param('studentId');
  const student=(await runtime.db.query<any>(`SELECT id,admission_number,student_number,first_name,middle_name,last_name FROM school_students WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,[studentId,p.organizationId])).rows[0];
  if(!student)throw new AppError(404,'STUDENT_NOT_FOUND','Student not found');
  const invoices=await runtime.db.query<any>(`SELECT DISTINCT d.id,d.number,d.issue_date,d.due_date,d.currency,d.total_minor,d.paid_minor,d.status FROM school_student_fee_charges ch JOIN documents d ON d.id=ch.document_id AND d.organization_id=ch.organization_id WHERE ch.organization_id=$1 AND ch.student_id=$2 AND d.type='invoice' ORDER BY d.issue_date,d.number`,[p.organizationId,studentId]);
  const receipts=await runtime.db.query<any>(`SELECT r.id,r.receipt_number,r.amount_minor,r.payment_date,r.reference,pmt.status payment_status,pmt.currency FROM school_fee_receipts r JOIN payments pmt ON pmt.id=r.payment_id AND pmt.organization_id=r.organization_id WHERE r.organization_id=$1 AND r.student_id=$2 ORDER BY r.payment_date,r.created_at`,[p.organizationId,studentId]);
  const billed=invoices.rows.reduce((n:number,x:any)=>n+Number(x.total_minor||0),0),paid=invoices.rows.reduce((n:number,x:any)=>n+Number(x.paid_minor||0),0);
  return c.json({data:{student:camel(student),summary:{billedMinor:billed,paidMinor:paid,balanceMinor:billed-paid},invoices:invoices.rows.map(camel),receipts:receipts.rows.map(camel)}});
 });

 r.get('/students/:studentId/statement.csv',async c=>{
  const p=c.get('principal'),studentId=c.req.param('studentId'),student=(await runtime.db.query<any>(`SELECT admission_number,student_number,concat_ws(' ',first_name,middle_name,last_name) student_name FROM school_students WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,[studentId,p.organizationId])).rows[0];
  if(!student)throw new AppError(404,'STUDENT_NOT_FOUND','Student not found');
  const q=await runtime.db.query<any>(`SELECT d.issue_date event_date,'invoice' event_type,d.number reference,d.total_minor::bigint debit_minor,0::bigint credit_minor FROM (SELECT DISTINCT ch.document_id,ch.organization_id FROM school_student_fee_charges ch WHERE ch.organization_id=$1 AND ch.student_id=$2) x JOIN documents d ON d.id=x.document_id AND d.organization_id=x.organization_id WHERE d.type='invoice' UNION ALL SELECT r.payment_date,'receipt',r.receipt_number,0::bigint,r.amount_minor::bigint FROM school_fee_receipts r JOIN payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND r.student_id=$2 AND p.status='posted' ORDER BY event_date,reference`,[p.organizationId,studentId]);
  let balance=0;const rows=q.rows.map((x:any)=>{balance+=Number(x.debit_minor||0)-Number(x.credit_minor||0);return[x.event_date,x.event_type,x.reference,Number(x.debit_minor||0),Number(x.credit_minor||0),balance];});
  return csvResponse(c,`fee-statement-${student.admission_number??student.student_number??studentId}.csv`,csv(['Date','Type','Reference','Debit Minor','Credit Minor','Balance Minor'],rows));
 });

 r.get('/reports/balances.csv',async c=>{
  const p=c.get('principal'),q=await runtime.db.query<any>(`WITH fee_docs AS (SELECT DISTINCT ch.organization_id,ch.student_id,d.id,d.total_minor,d.paid_minor FROM school_student_fee_charges ch JOIN documents d ON d.id=ch.document_id AND d.organization_id=ch.organization_id WHERE ch.organization_id=$1 AND d.status<>'void') SELECT s.admission_number,s.student_number,concat_ws(' ',s.first_name,s.middle_name,s.last_name) student_name,COALESCE(SUM(fd.total_minor),0)::bigint billed_minor,COALESCE(SUM(fd.paid_minor),0)::bigint paid_minor,COALESCE(SUM(fd.total_minor-fd.paid_minor),0)::bigint balance_minor FROM school_students s LEFT JOIN fee_docs fd ON fd.student_id=s.id AND fd.organization_id=s.organization_id WHERE s.organization_id=$1 AND s.deleted_at IS NULL GROUP BY s.id,s.admission_number,s.student_number,s.first_name,s.middle_name,s.last_name ORDER BY s.last_name,s.first_name`,[p.organizationId]);
  return csvResponse(c,'school-fee-balances.csv',csv(['Admission Number','Student Number','Student Name','Billed Minor','Paid Minor','Balance Minor'],q.rows.map((x:any)=>[x.admission_number,x.student_number,x.student_name,x.billed_minor,x.paid_minor,x.balance_minor])));
 });

 r.get('/receipts.csv',async c=>{
  const p=c.get('principal'),from=c.req.query('from')??null,to=c.req.query('to')??null,q=await runtime.db.query<any>(`SELECT r.receipt_number,r.payment_date,r.amount_minor,r.reference,s.admission_number,s.student_number,concat_ws(' ',s.first_name,s.middle_name,s.last_name) student_name,p.status payment_status,p.currency FROM school_fee_receipts r JOIN school_students s ON s.id=r.student_id JOIN payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND ($2::date IS NULL OR r.payment_date>=$2::date) AND ($3::date IS NULL OR r.payment_date<=$3::date) ORDER BY r.payment_date DESC,r.created_at DESC`,[p.organizationId,from,to]);
  return csvResponse(c,'school-fee-receipts.csv',csv(['Receipt Number','Date','Admission Number','Student Number','Student Name','Amount Minor','Currency','Reference','Payment Status'],q.rows.map((x:any)=>[x.receipt_number,x.payment_date,x.admission_number,x.student_number,x.student_name,x.amount_minor,x.currency,x.reference,x.payment_status])));
 });

 r.get('/reports/collections.csv',async c=>{
  const p=c.get('principal'),from=c.req.query('from')??null,to=c.req.query('to')??null,q=await runtime.db.query<any>(`SELECT r.payment_date,COUNT(*)::int receipts,COALESCE(SUM(r.amount_minor),0)::bigint amount_minor FROM school_fee_receipts r JOIN payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND p.status='posted' AND ($2::date IS NULL OR r.payment_date>=$2::date) AND ($3::date IS NULL OR r.payment_date<=$3::date) GROUP BY r.payment_date ORDER BY r.payment_date DESC`,[p.organizationId,from,to]);
  return csvResponse(c,'school-fee-collections.csv',csv(['Date','Receipts','Amount Minor'],q.rows.map((x:any)=>[x.payment_date,x.receipts,x.amount_minor])));
 });
 return r;
}
