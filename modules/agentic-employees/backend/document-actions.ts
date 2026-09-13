import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { AgentDocumentFormat, AuthPrincipal, Env } from "../../../src/types";
import { hasScope } from "./policy";
import { stageGeneratedPdf,submitGovernedPrintJob } from "../../printerly/backend/agentic-print";
import * as Printerly from "../../printerly/backend/service";

export type GenerateDocumentPayload={title?:string;format?:AgentDocumentFormat;spec?:Record<string,unknown>;conversationId?:string|null};
export type PrintDocumentPayload={documentId?:string;printerId?:string|null;copies?:number;estimatedPages?:number;pageSize?:string;colorMode?:string;duplex?:boolean;secureRelease?:boolean;priority?:string};

export async function executeDocumentGenerateAction(env:Env,principal:AuthPrincipal,payload:GenerateDocumentPayload,actionId?:string|null){
  if(!hasScope(principal,"documents:write"))throw new AppError(403,"FORBIDDEN","Generating an approved AI document requires documents:write");
  if(!env.AGENT_DOCUMENT_SERVICE)throw new AppError(503,"DOCUMENT_RUNTIME_REQUIRED","Office document generation is available on the Ledgerly self-hosted document runtime");
  const format=String(payload.format||"") as AgentDocumentFormat;if(!["docx","xlsx","pptx"].includes(format))throw new AppError(422,"INVALID_DOCUMENT_FORMAT","Document format must be DOCX, XLSX or PPTX");
  const title=String(payload.title||"").trim().slice(0,240);if(!title)throw new AppError(422,"VALIDATION_ERROR","Document title is required");
  const spec=payload.spec&&typeof payload.spec==="object"&&!Array.isArray(payload.spec)?payload.spec:{};
  const documentId=createId("aedoc"),agent=actionId?await env.FINANCE_DB.prepare("SELECT agent_key AS agentKey FROM ae_actions WHERE id=? AND organization_id=?").bind(actionId,principal.organizationId).first<{agentKey:string}>():null;
  const agentKey=agent?.agentKey||"headteacher";
  const artifact=await env.AGENT_DOCUMENT_SERVICE.generate({documentId,organizationId:principal.organizationId,agentKey,title,format,spec});
  try{
    await env.FINANCE_DB.prepare(`INSERT INTO ae_generated_documents
      (id,organization_id,agent_key,conversation_id,action_id,title,format,source_object_key,pdf_object_key,source_mime_type,source_size_bytes,pdf_size_bytes,checksum_sha256,spec_json,status,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'saved',?)`).bind(documentId,principal.organizationId,agentKey,payload.conversationId||null,actionId||null,title,format,artifact.sourceObjectKey,artifact.pdfObjectKey,artifact.sourceMimeType,artifact.sourceSizeBytes,artifact.pdfSizeBytes,artifact.checksumSha256,JSON.stringify(spec),principal.userId).run();
  }catch(error){await Promise.all([env.WORK_FILES_BUCKET.delete(artifact.sourceObjectKey).catch(()=>{}),env.WORK_FILES_BUCKET.delete(artifact.pdfObjectKey).catch(()=>{})]);throw error;}
  return{entityType:"agent_document",entityId:documentId,documentId,title,format,...artifact};
}

export async function executeDocumentPrintAction(env:Env,principal:AuthPrincipal,payload:PrintDocumentPayload){
  if(!hasScope(principal,"documents:write"))throw new AppError(403,"FORBIDDEN","Printing an AI document requires documents:write");
  const documentId=String(payload.documentId||"").trim();
  const doc=await env.FINANCE_DB.prepare(`SELECT id,title,pdf_object_key AS pdfObjectKey,status FROM ae_generated_documents WHERE id=? AND organization_id=?`).bind(documentId,principal.organizationId).first<any>();
  if(!doc||doc.status!=="saved")throw new AppError(404,"AGENT_DOCUMENT_NOT_FOUND","Saved AI document not found");
  const staged=await stageGeneratedPdf(env,principal,doc);
  try{
    const result=await submitGovernedPrintJob(env,principal,{documentId:staged.documentId,title:doc.title,printerId:payload.printerId||null,copies:payload.copies||1,estimatedPages:payload.estimatedPages||1,pageSize:payload.pageSize||"A4",colorMode:payload.colorMode||"monochrome",duplex:Boolean(payload.duplex),secureRelease:Boolean(payload.secureRelease),priority:payload.priority||"normal"});
    return{entityType:"printerly_job",entityId:result.id,printerlyJobId:result.id,sourceDocumentId:documentId,printerlyDocumentId:staged.documentId,...result};
  }catch(error){await Printerly.deleteStagedDocument(env.FINANCE_DB,env.WORK_FILES_BUCKET,principal.organizationId,staged.documentId).catch(()=>{});throw error;}
}
