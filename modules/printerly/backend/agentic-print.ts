import { createId } from "../../../src/lib/ids";
import { AppError } from "../../../src/lib/errors";
import type { AuthPrincipal, Env } from "../../../src/types";
import * as S from "./service";
import * as Cost from "./costing";
import * as Quota from "./quota";
import * as Rules from "./rules";

async function sha256(bytes:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");}
function safeName(value:string){return String(value||"agent-document").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,160)||"agent-document";}

export async function stageGeneratedPdf(env:Env,principal:AuthPrincipal,document:{id:string;title:string;pdfObjectKey:string}){
  const object=await env.WORK_FILES_BUCKET.get(document.pdfObjectKey);
  if(!object)throw new AppError(404,"AGENT_DOCUMENT_FILE_MISSING","The saved printable PDF is missing from document storage");
  const bytes=await object.arrayBuffer(),checksum=await sha256(bytes),printerlyDocumentId=createId("prndoc"),created=new Date().toISOString();
  const name=`${safeName(document.title)}.pdf`,objectKey=`printerly/${principal.organizationId}/${created.slice(0,7)}/${printerlyDocumentId}/${name}`;
  await env.WORK_FILES_BUCKET.put(objectKey,bytes,{httpMetadata:{contentType:"application/pdf",contentDisposition:`inline; filename="${name}"`},customMetadata:{organizationId:principal.organizationId,documentId:printerlyDocumentId,sourceAgentDocumentId:document.id,checksum}});
  try{
    await env.FINANCE_DB.prepare("INSERT INTO prn_documents(id,organization_id,object_key,original_name,mime_type,size_bytes,checksum_sha256,status,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,'staged',?,?)")
      .bind(printerlyDocumentId,principal.organizationId,objectKey,name,"application/pdf",bytes.byteLength,checksum,principal.userId,created).run();
  }catch(error){await env.WORK_FILES_BUCKET.delete(objectKey).catch(()=>{});throw error;}
  return{documentId:printerlyDocumentId,checksum,sizeBytes:bytes.byteLength};
}

export async function submitGovernedPrintJob(env:Env,principal:AuthPrincipal,body:Record<string,unknown>){
  const initial=await Cost.prepareJobCosting(env.FINANCE_DB,principal.organizationId,body);
  const policy=await Rules.evaluatePrintPolicy(env.FINANCE_DB,principal.organizationId,principal,body,initial);
  if(policy.blocked)throw new AppError(409,"PRINT_POLICY_BLOCKED",policy.blockedReason||"This print request is blocked by an organization Printerly policy",{rules:policy.applied});
  const effective=policy.effective,prepared=await Cost.prepareJobCosting(env.FINANCE_DB,principal.organizationId,effective);
  const reservation=await Quota.reserveRequest(env,principal.organizationId,principal.userId,prepared);
  let job:any=null,approval:any=null;
  try{
    job=policy.requiresApproval?await Rules.createPendingJob(env.FINANCE_DB,principal.organizationId,principal.userId,effective):await S.createJob(env.FINANCE_DB,principal.organizationId,principal.userId,effective);
    if(policy.requiresApproval)approval=await Rules.createApproval(env.FINANCE_DB,principal.organizationId,principal.userId,job.id,policy);
    await Cost.attachJobCosting(env.FINANCE_DB,principal.organizationId,job.id,prepared);
    await Quota.attachReservationGroup(env.FINANCE_DB,principal.organizationId,reservation.groupId,job.id);
    return{...job,costing:prepared,quota:reservation.check,policy:{blocked:false,requiresApproval:policy.requiresApproval,applied:policy.applied,messages:policy.messages,effective:policy.effective},approval};
  }catch(error){
    await Quota.releaseReservationGroup(env.FINANCE_DB,principal.organizationId,reservation.groupId).catch(()=>{});
    if(job?.id){if(policy.requiresApproval){const cancelled=await Rules.cancelPendingApproval(env.FINANCE_DB,principal.organizationId,principal.userId,job.id).catch(()=>null);if(!cancelled)await Rules.abortPendingJob(env.FINANCE_DB,principal.organizationId,principal.userId,job.id).catch(()=>{});}else await S.cancelJob(env.FINANCE_DB,principal.organizationId,principal.userId,job.id).catch(()=>{});}
    throw error;
  }
}
