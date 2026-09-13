import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Runtime } from '../../runtime.js';
import { AppError } from '../../http/errors.js';
import { createId } from '../core-identity/security.js';
import { ensureCostProfile, postPrinterlyCost } from './costing-core.js';
import { getReceiptPrintSettings, receiptAmountInWords } from './auto-receipts.js';

type ReceiptPayment={id:string;number:string;paymentDate:string;currency:string;amountMinor:number;reference:string|null;contactName:string;organizationName:string;taxRegistrationNumber:string|null};

async function receipt(runtime:Runtime,org:string,paymentId:string){
  const q=await runtime.db.query<ReceiptPayment>(`SELECT p.id,p.number,p.payment_date::text AS "paymentDate",p.currency,p.amount_minor::float8 AS "amountMinor",p.reference,c.name AS "contactName",o.name AS "organizationName",o.tax_registration_number AS "taxRegistrationNumber" FROM payments p JOIN contacts c ON c.id=p.contact_id AND c.organization_id=p.organization_id JOIN organizations o ON o.id=p.organization_id WHERE p.organization_id=$1 AND p.id=$2 AND p.type='receipt' AND p.status='posted'`,[org,paymentId]);
  if(!q.rowCount)throw new AppError(404,'POSTED_RECEIPT_NOT_FOUND','Posted receipt payment was not found');
  return q.rows[0]!;
}

async function render(runtime:Runtime,org:string,p:ReceiptPayment){
  const a=await runtime.db.query<{number:string;amountMinor:number}>(`SELECT d.number,a.amount_minor::float8 AS "amountMinor" FROM payment_allocations a JOIN documents d ON d.id=a.document_id AND d.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.payment_id=$2 AND a.reversed_at IS NULL ORDER BY a.created_at`,[org,p.id]);
  const allocated=a.rows.reduce((s,r)=>s+Number(r.amountMinor),0),pdf=await PDFDocument.create(),page=pdf.addPage([419.53,595.28]),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),width=page.getWidth(),margin=34;
  let y=page.getHeight()-38;
  const text=(v:string,size=10,b=false)=>{page.drawText(v.slice(0,92),{x:margin,y,size,font:b?bold:regular,color:rgb(0,0,0)});y-=size+6;};
  const line=()=>{page.drawLine({start:{x:margin,y},end:{x:width-margin,y},thickness:.6,color:rgb(.55,.55,.55)});y-=14;};
  const money=(n:number)=>`${p.currency.toUpperCase()} ${new Intl.NumberFormat('en-UG').format(n)}`;
  text(p.organizationName,16,true);text('OFFICIAL RECEIPT · REPRINT',13,true);if(p.taxRegistrationNumber)text(`TIN: ${p.taxRegistrationNumber}`,8);line();
  text(`Receipt No: ${p.number}`,11,true);text(`Date: ${p.paymentDate}`);text(`Received from: ${p.contactName}`);if(p.reference)text(`Reference: ${p.reference}`,9);line();
  text(`Amount received: ${money(p.amountMinor)}`,13,true);text(`In words: ${receiptAmountInWords(p.amountMinor,p.currency)}`,9);line();
  if(a.rows.length){text('Applied to',10,true);for(const x of a.rows.slice(0,8))text(`${x.number}: ${money(Number(x.amountMinor))}`,9);if(a.rows.length>8)text(`+ ${a.rows.length-8} more allocation(s)`,8);}else text('Applied to: Unallocated customer credit',9);
  text(`Unallocated balance: ${money(Math.max(0,p.amountMinor-allocated))}`,10,true);y-=8;line();text('Reprinted from the original Ledgerly receipt record',8);text('Thank you.',10,true);
  return new Uint8Array(await pdf.save());
}

async function readyPrinter(runtime:Runtime,org:string,preferred:string|null){
  return (await runtime.db.query<{id:string;name:string}>(`SELECT p.id,p.name FROM prn_printers p JOIN prn_nodes n ON n.id=p.node_id AND n.organization_id=p.organization_id WHERE p.organization_id=$1 AND p.status='ready' AND n.status='online' AND n.revoked_at IS NULL ORDER BY CASE WHEN p.id=$2 THEN 0 ELSE 1 END,p.last_seen_at DESC NULLS LAST,p.name LIMIT 1`,[org,preferred])).rows[0];
}

export async function createReceiptReprint(runtime:Runtime,org:string,paymentId:string,actor:string){
  const lock=await runtime.db.connect(),key=`receipt-reprint:${org}:${paymentId}`;
  try{
    await lock.query('SELECT pg_advisory_lock(hashtext($1)::bigint)',[key]);
    const active=await runtime.db.query(`SELECT 1 FROM prn_receipt_reprints r JOIN prn_jobs j ON j.id=r.printerly_job_id AND j.organization_id=r.organization_id WHERE r.organization_id=$1 AND r.payment_id=$2 AND j.status IN ('queued','claimed','downloading','spooling','printing') LIMIT 1`,[org,paymentId]);
    if(active.rowCount)throw new AppError(409,'RECEIPT_REPRINT_ACTIVE','A reprint of this receipt is already in progress');
    const settings=await getReceiptPrintSettings(runtime,org),printer=await readyPrinter(runtime,org,settings.printerId);
    if(!printer)throw new AppError(409,'NO_RECEIPT_PRINTER_AVAILABLE','No online ready Printerly printer is available for the reprint');
    const p=await receipt(runtime,org,paymentId),bytes=await render(runtime,org,p),docId=createId('prndoc'),jobId=createId('prnjob'),reprintId=createId('rpr'),safe=p.number.replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,80)||p.id;
    const objectKey=`printerly/${org}/receipt-reprints/${p.id}/${docId}/${safe}.pdf`,checksum=createHash('sha256').update(bytes).digest('hex'),jobNumber=`RPR-${p.id.slice(-6).toUpperCase()}-${jobId.slice(-6).toUpperCase()}`,profile=await ensureCostProfile(runtime,org),impressions=settings.copies,sheets=settings.copies;
    const estimated=sheets*Number(profile.paperCostMinor??0)+impressions*Number(profile.bwTonerCostMinor??0)+impressions*Number(profile.maintenanceCostMinor??0)+impressions*Number(profile.electricityCostMinor??0);
    await runtime.storage.put(objectKey,bytes,'application/pdf');
    const c=await runtime.db.connect();
    try{
      await c.query('BEGIN');
      await c.query(`INSERT INTO prn_documents(id,organization_id,object_key,original_name,mime_type,size_bytes,checksum_sha256,status,uploaded_by) VALUES($1,$2,$3,$4,'application/pdf',$5,$6,'staged',$7)`,[docId,org,objectKey,`Receipt-${safe}-reprint.pdf`,bytes.byteLength,checksum,actor]);
      await c.query(`INSERT INTO prn_jobs(id,organization_id,job_number,title,document_id,printer_id,status,priority,copies,page_size,color_mode,duplex,secure_release,total_sheets,estimated_pages,estimated_impressions,estimated_sheets,estimated_cost_minor,charge_department_type,source_module,source_reference,created_by) VALUES($1,$2,$3,$4,$5,$6,'queued','urgent',$7,$8,'monochrome',false,false,$9,1,$10,$9,$11,'finance','receipt_reprint',$12,$13)`,[jobId,org,jobNumber,`Receipt ${p.number} reprint`,docId,printer.id,settings.copies,settings.pageSize,sheets,impressions,estimated,p.id,actor]);
      await c.query(`UPDATE prn_documents SET status='attached',job_id=$1,attached_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,[jobId,docId,org]);
      await c.query(`INSERT INTO prn_receipt_reprints(id,organization_id,payment_id,printerly_document_id,printerly_job_id,requested_by) VALUES($1,$2,$3,$4,$5,$6)`,[reprintId,org,p.id,docId,jobId,actor]);
      await c.query(`INSERT INTO prn_job_events(id,organization_id,job_id,event_type,actor_id,details) VALUES($1,$2,$3,'created',$4,$5::jsonb)`,[createId('prnev'),org,jobId,actor,JSON.stringify({receiptReprint:true,paymentId:p.id,printerId:printer.id})]);
      await c.query('COMMIT');
      return {id:reprintId,paymentId:p.id,receiptNumber:p.number,jobId,jobNumber,status:'queued',printerId:printer.id};
    }catch(e){await c.query('ROLLBACK');await runtime.storage.delete(objectKey).catch(()=>undefined);throw e;}finally{c.release();}
  }finally{try{await lock.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)',[key]);}finally{lock.release();}}
}

async function charge(runtime:Runtime,org:string,reprintId:string,jobId:string){
  const settings=await getReceiptPrintSettings(runtime,org);
  if(!settings.autoChargeFinance){await runtime.db.query(`UPDATE prn_receipt_reprints SET finance_status='not_applicable',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND id=$2`,[org,reprintId]);return {status:'not_applicable' as const};}
  const cost=(await runtime.db.query<{totalCostMinor:number}>(`SELECT total_cost_minor::float8 AS "totalCostMinor" FROM prn_cost_ledger WHERE organization_id=$1 AND job_id=$2`,[org,jobId])).rows[0];
  if(!cost||Number(cost.totalCostMinor)<=0){const m='Printerly receipt reprint cost is zero or unavailable; configure Printerly costing before Finance can be charged';await runtime.db.query(`UPDATE prn_receipt_reprints SET finance_status='failed',last_error=$1,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$2 AND id=$3`,[m,org,reprintId]);return {status:'failed' as const,error:m};}
  try{const posting=await postPrinterlyCost(runtime,org,'system:receipt-printing',jobId);await runtime.db.query(`UPDATE prn_receipt_reprints SET finance_status='posted',finance_journal_id=$1,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$2 AND id=$3`,[posting.journalEntryId,org,reprintId]);return {status:'posted' as const,journalEntryId:posting.journalEntryId};}
  catch(e){const m=e instanceof Error?e.message:String(e);await runtime.db.query(`UPDATE prn_receipt_reprints SET finance_status='failed',last_error=$1,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$2 AND id=$3`,[m.slice(0,1500),org,reprintId]);return {status:'failed' as const,error:m};}
}

export async function syncReceiptReprintJobStatus(runtime:Runtime,org:string,jobId:string,status:string,error?:string|null){
  const r=(await runtime.db.query<{id:string}>(`SELECT id FROM prn_receipt_reprints WHERE organization_id=$1 AND printerly_job_id=$2`,[org,jobId])).rows[0];
  if(!r)return null;
  if(['claimed','downloading','spooling','printing'].includes(status)){await runtime.db.query(`UPDATE prn_receipt_reprints SET status='printing',updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND id=$2`,[org,r.id]);return {status:'printing'};}
  if(status==='failed'||status==='cancelled'){await runtime.db.query(`UPDATE prn_receipt_reprints SET status='failed',last_error=$1,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$2 AND id=$3`,[error??`Printerly job ${status}`,org,r.id]);return {status:'failed'};}
  if(status==='completed'){await runtime.db.query(`UPDATE prn_receipt_reprints SET status='completed',completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND id=$2`,[org,r.id]);return {status:'completed',finance:await charge(runtime,org,r.id,jobId)};}
  return {status};
}

export async function listReceiptReprints(runtime:Runtime,org:string,limit=100){
  const n=Math.min(Math.max(Math.trunc(limit)||100,1),500);
  return (await runtime.db.query(`SELECT r.id,r.payment_id AS "paymentId",p.number AS "receiptNumber",p.payment_date::text AS "paymentDate",p.amount_minor::float8 AS "amountMinor",p.currency,r.status,r.finance_status AS "financeStatus",r.printerly_job_id AS "printerlyJobId",j.job_number AS "jobNumber",j.printer_id AS "printerId",r.finance_journal_id AS "financeJournalId",r.last_error AS "lastError",r.completed_at AS "completedAt",r.created_at AS "createdAt",u.display_name AS "requestedByName" FROM prn_receipt_reprints r JOIN payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id JOIN prn_jobs j ON j.id=r.printerly_job_id AND j.organization_id=r.organization_id LEFT JOIN users u ON u.id=r.requested_by WHERE r.organization_id=$1 ORDER BY r.created_at DESC LIMIT $2`,[org,n])).rows;
}

export async function retryReceiptReprint(runtime:Runtime,org:string,reprintId:string){
  const r=(await runtime.db.query<{status:string;financeStatus:string;jobId:string}>(`SELECT status,finance_status AS "financeStatus",printerly_job_id AS "jobId" FROM prn_receipt_reprints WHERE organization_id=$1 AND id=$2`,[org,reprintId])).rows[0];
  if(!r)throw new AppError(404,'RECEIPT_REPRINT_NOT_FOUND','Receipt reprint was not found');
  if(r.status==='completed'&&r.financeStatus==='failed')return charge(runtime,org,reprintId,r.jobId);
  if(r.status!=='failed')throw new AppError(409,'RECEIPT_REPRINT_ACTIVE','Only failed reprints can be retried');
  const q=await runtime.db.query(`UPDATE prn_jobs SET status='queued',node_id=NULL,claim_token_hash=NULL,claimed_at=NULL,claim_expires_at=NULL,lease_renewed_at=NULL,error_message=NULL,completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND id=$2 AND status='failed' RETURNING id`,[org,r.jobId]);
  if(!q.rowCount)throw new AppError(409,'RECEIPT_REPRINT_JOB_STATE','The Printerly reprint job is not in a retryable state');
  await runtime.db.query(`UPDATE prn_receipt_reprints SET status='queued',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND id=$2`,[org,reprintId]);
  return {id:reprintId,jobId:r.jobId,status:'queued'};
}
