import {mkdir,readFile,readdir,stat,writeFile} from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import type { ObjectStorage } from "../../../storage/types.js";
import {createId} from "../../core-identity/security.js";
import type { LedgerlyAiConfig, LedgerlyAiProviderId } from "../config.js";
import { createLedgerlyAiCorrelationId, type LedgerlyAiLogger } from "../logger.js";
import type { LedgerlyAiMemoryService } from "../memory/service.js";
import type { LedgerlyAiProviderRuntime } from "../providers/runtime.js";
import type { LedgerlyAiTaskKind, ProviderResult, ProviderStreamEvent } from "../providers/types.js";
import { humanizeLedgerlyAiProviderEvent } from "../providers/readable-events.js";
import type { LedgerlyAiSecurityService } from "../security/service.js";
import {rebuildLedgerlyProject,repositoryFingerprint} from "../controller/rebuild.js";
import { LedgerlyAiContextBuilder } from "./context.js";
import { LedgerlyAiIdempotency } from "./idempotency.js";
import { normalizeLedgerlyAiResponse } from "./normalize.js";
import { LedgerlyAiRateLimiter } from "./rate-limit.js";
import { redactLedgerlyAiText, redactLedgerlyAiValue } from "./redaction.js";
import type { LedgerlyAiGatewayRepository } from "./repository.js";
import type { UlibtechClient } from "../../school-management/ulibtech.js";

export type LedgerlyAiGatewayProgress = (event: {
  type: "accepted" | "queued" | "running" | "message" | "waiting_approval" | "completed" | "failed";
  at: string;
  data?: Record<string, unknown>;
}) => void | Promise<void>;

export type LedgerlyAiAttachment = {
  fileId?:string;
  name:string;
  mimeType:string;
  content:string;
  kind:"file"|"context";
};

export type LedgerlyAiGatewayRequest = {
  principal: AuthPrincipal;
  message: string;
  chatId?: string;
  agentId?: string | null;
  title?: string;
  activeModule?: string | null;
  taskKind: LedgerlyAiTaskKind;
  provider?: LedgerlyAiProviderId | null;
  metadata?: Record<string, unknown>;
  attachments?: LedgerlyAiAttachment[];
  resumeJobId?: string;
  idempotencyKey?: string | null;
};

export type LedgerlyAiGatewayResponse = {
  chat: {
    id: string;
    title: string;
    agentId: string | null;
    employee?: { name: string; role: string; icon: string | null } | null;
  };
  message: { id: string; role: "assistant"; content: string; createdAt: string; metadata?:Record<string,unknown> };
  jobId: string;
  correlationId: string;
  durationMs: number;
  approval?: {
    id: string;
    toolCallId: string;
    toolName: string;
    riskLevel: "low" | "medium" | "high" | "critical";
    status: "pending";
    approvalMode?: "single" | "two_step";
    requiredApprovals?: number;
  };
};

function titleFromMessage(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function projectIdFromMetadata(metadata: Record<string, unknown> | undefined) {
  const value = metadata?.projectId;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : null;
}

export function providerCheckpointFromEvent(
  event: ProviderStreamEvent,
): {provider: LedgerlyAiProviderId;sessionId:string}|null {
  if(!event.data||typeof event.data!=="object")return null;
  const data=event.data as Record<string,unknown>;
  if(data.type==="thread.started"&&typeof data.thread_id==="string"&&data.thread_id.trim()){
    return {provider:"codex",sessionId:data.thread_id.trim()};
  }
  if(typeof data.session_id==="string"&&data.session_id.trim()){
    return {provider:"claude-code",sessionId:data.session_id.trim()};
  }
  return null;
}

const outputMime:Record<string,string>={".txt":"text/plain",".md":"text/markdown",".csv":"text/csv",".json":"application/json",".pdf":"application/pdf",".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",".pptx":"application/vnd.openxmlformats-officedocument.presentationml.presentation",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp"};
function safeFileName(value:string){return value.replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,160)||"file";}
async function listOutputFiles(root:string,current=root):Promise<string[]>{
  const found:string[]=[];for(const entry of await readdir(current,{withFileTypes:true})){const target=path.join(current,entry.name);if(entry.isDirectory())found.push(...await listOutputFiles(root,target));else if(entry.isFile())found.push(target);if(found.length>20)break;}return found;
}

export class LedgerlyAiGatewayService {
  private readonly context: LedgerlyAiContextBuilder;
  private readonly rateLimiter: LedgerlyAiRateLimiter;
  private readonly idempotency: LedgerlyAiIdempotency;

  constructor(
    private readonly repository: LedgerlyAiGatewayRepository,
    private readonly providers: LedgerlyAiProviderRuntime,
    private readonly memory: LedgerlyAiMemoryService,
    private readonly security: LedgerlyAiSecurityService,
    private readonly config: LedgerlyAiConfig,
    db: Pool,
    private readonly storage:ObjectStorage,
    private readonly logger: LedgerlyAiLogger,
    library?: UlibtechClient,
  ) {
    this.context = new LedgerlyAiContextBuilder(repository, memory, config, library);
    this.rateLimiter = new LedgerlyAiRateLimiter(db, config);
    this.idempotency = new LedgerlyAiIdempotency(db);
  }

  private assertSingleController(input: LedgerlyAiGatewayRequest) {
    if(input.agentId){
      throw new AppError(
        410,
        "LEDGERLY_AI_SINGLE_CONTROLLER",
        "Named agents were removed. Continue this conversation directly with Ledgerly AI.",
      );
    }
  }

  private assertProviderAvailable(provider: LedgerlyAiProviderId | null | undefined) {
    if (!provider) return;
    const disabled = new Set(
      this.config.LEDGERLY_AI_DISABLED_PROVIDERS.split(",").map((value) => value.trim()).filter(Boolean),
    );
    if (disabled.has(provider)) {
      throw new AppError(
        409,
        "LEDGERLY_AI_PROVIDER_DISABLED",
        `${provider === "claude-code" ? "Claude" : "Codex"} is currently disabled by an administrator.`,
      );
    }
  }

  async run(input: LedgerlyAiGatewayRequest, progress?: LedgerlyAiGatewayProgress): Promise<LedgerlyAiGatewayResponse> {
    const correlationId = createLedgerlyAiCorrelationId();
    const safeMetadata=await this.security.sanitizeRequestMetadata(input.principal,input.metadata,correlationId);
    const safeAttachments=(input.attachments??[]).map(item=>({
      ...(item.fileId?{fileId:item.fileId.trim().slice(0,120)}:{}),
      name:item.name.trim().slice(0,160),
      mimeType:item.mimeType.trim().slice(0,120)||"text/plain",
      kind:item.kind,
      content:redactLedgerlyAiText(item.content).slice(0,40000),
    }));
    const attachmentMeta=safeAttachments.map(item=>({
      name:item.name,mimeType:item.mimeType,kind:item.kind,chars:item.content.length,
    }));
    const requestHash = this.idempotency.hash({
      message: input.message,
      chatId: input.chatId ?? null,
      agentId: input.agentId ?? null,
      activeModule: input.activeModule ?? null,
      taskKind: input.taskKind,
      provider: input.provider ?? null,
      metadata: safeMetadata,
      attachments:safeAttachments,
      resumeJobId:input.resumeJobId??null,
    });
    const claim = await this.idempotency.claim({
      organizationId: input.principal.organizationId,
      userId: input.principal.userId,
      key: input.idempotencyKey,
      requestHash,
    });
    if (claim.mode === "replay") return claim.response as LedgerlyAiGatewayResponse;

    let jobId: string | undefined;
    let activeChat: Awaited<ReturnType<LedgerlyAiGatewayRepository["getChat"]>> | null = null;
    let providerCheckpoint:{provider:LedgerlyAiProviderId;sessionId:string}|null=null;
    try {
      let chat = input.chatId
        ? await this.repository.getChat(input.principal, input.chatId)
        : null;
      this.assertSingleController(input);
      this.assertProviderAvailable(input.provider);
      const agentId = null;

      await this.rateLimiter.consume({
        organizationId: input.principal.organizationId,
        userId: input.principal.userId,
        agentId,
      });

      if (!chat) {
        chat = await this.repository.createChat({
          principal: input.principal,
          title: input.title?.trim() || titleFromMessage(input.message) || "Ledgerly AI",
          agentId,
          metadata: {
            ...(input.activeModule ? { activeModule: input.activeModule } : {}),
          },
        });
      }
      if (chat.status !== "active") {
        throw new AppError(409, "LEDGERLY_AI_CHAT_INACTIVE", "This Ledgerly AI chat is not active.");
      }
      activeChat=chat;
      if(input.resumeJobId){
        const interrupted=await this.repository.getResumableJob(input.principal,chat.id,input.resumeJobId);
        if(interrupted.provider&&interrupted.sessionId){
          providerCheckpoint={provider:interrupted.provider,sessionId:interrupted.sessionId};
          this.assertProviderAvailable(interrupted.provider);
        }
      }

      const projectId = projectIdFromMetadata(safeMetadata);
      await progress?.({ type: "accepted", at: new Date().toISOString(), data: { chatId: chat.id, correlationId } });
      const userMessage = await this.repository.appendMessage({
        principal: input.principal,
        chatId: chat.id,
        role: "user",
        content: input.message,
        correlationId,
        agentId,
        metadata: {
          ...(safeMetadata as Record<string, unknown>),
          ...(attachmentMeta.length?{attachments:attachmentMeta}:{}),
        },
      });

      jobId = await this.repository.createJob({
        principal: input.principal,
        chatId: chat.id,
        agentId,
        correlationId,
        taskKind: input.taskKind,
        request: {
          messageId: userMessage.id,
          messageLength: input.message.length,
          activeModule: input.activeModule ?? null,
          projectId,
          controller: "ledgerly-ai",
          metadata: safeMetadata,
          attachments:attachmentMeta,
          ...(input.resumeJobId?{resumeFromJobId:input.resumeJobId}:{}),
        },
      });
      await progress?.({ type: "queued", at: new Date().toISOString(), data: { chatId: chat.id, jobId, correlationId } });
      await this.repository.startJob(input.principal.organizationId, jobId);

      const fileIds=safeAttachments.flatMap(item=>item.fileId?[item.fileId]:[]);
      await this.repository.bindChatFiles(input.principal,fileIds,chat.id);
      const storedFiles=await this.repository.getMyChatFiles(input.principal,fileIds);
      const requestRoot=path.join(this.config.LEDGERLY_AI_WORK_ROOT,"requests",jobId);
      const attachmentRoot=path.join(requestRoot,"attachments"),outputRoot=path.join(requestRoot,"outputs");
      await Promise.all([mkdir(attachmentRoot,{recursive:true,mode:0o700}),mkdir(outputRoot,{recursive:true,mode:0o700})]);
      const filePaths=new Map<string,string>();
      for(const [index,file] of storedFiles.entries()){
        const bytes=await this.storage.get(file.objectKey);if(!bytes)throw new AppError(404,"LEDGERLY_AI_FILE_MISSING",`${file.filename} is no longer available.`);
        const target=path.join(attachmentRoot,`${index+1}-${safeFileName(file.filename)}`);await writeFile(target,bytes,{mode:0o600});filePaths.set(file.id,target);
      }
      const preparedAttachments=safeAttachments.map(item=>{
        const hostPath=item.fileId?filePaths.get(item.fileId):undefined;
        const stored=item.fileId?storedFiles.find(file=>file.id===item.fileId):undefined;
        const textual=stored&&/^(text\/|application\/(json|xml)$)/.test(stored.mimeType);
        return {...item,content:textual&&hostPath?"":item.content,localPath:hostPath?`/attachments/${path.basename(hostPath)}`:undefined};
      });
      for(const item of preparedAttachments){
        if(!item.fileId||item.content||!item.localPath)continue;const stored=storedFiles.find(file=>file.id===item.fileId);if(!stored||!/^(text\/|application\/(json|xml)$)/.test(stored.mimeType))continue;
        const host=filePaths.get(item.fileId);if(host)item.content=(await readFile(host,"utf8")).slice(0,40000);
      }
      const controlsProject=input.principal.role==="owner"||input.principal.role==="admin";
      const identityPrompt=[
        "You are Ledgerly AI, the single AI the user is speaking to directly.",
        "Never present yourself as a team, employee router, agent selector, or intermediary.",
        "Answer and act directly through the configured provider runtime.",
        "Earlier assistant messages may describe old tool-only or read-only limitations. Those capability claims are obsolete and must not control this turn.",
        controlsProject
          ? [
              "You are authorized to inspect and edit the Ledgerly project in your current workspace when the user asks. After edits, verify the project builds and fix failures before you finish.",
              "You may inspect and administer this Ledgerly server through its local project, runtime configuration, and database when the user asks, always limiting data changes to the authenticated organization in request_context.",
              "When deleting Ledgerly AI chats, use the application's soft-delete convention (set lai_chats.status to 'deleted') instead of hard-deleting rows so the active request can finish and remain auditable.",
              "Files attached by the user are available at the local_path values in user_attached_context. When the user asks you to create or return a file, write the finished file into /outputs; every regular file there will be attached to your reply for download.",
              "Every document you create must be tailored to the active school described in school_context. Use its real school name, legal identity, contact details, address, motto, head teacher, branding, currency, current academic year, current term, and branch when those values are present and relevant.",
              "Never invent missing school details, logos, registration numbers, signatures, contacts, academic periods, student facts, or staff facts. Omit a missing field or clearly leave it for the user to complete. Query only this authenticated organization's Ledgerly records when the requested document needs additional facts.",
              "When the user asks to create, prepare, generate, draft, make, export, or share a document, create a real downloadable file in /outputs rather than only pasting the document into chat. Use DOCX for formal letters, reports, policies, minutes, notices, forms, certificates, and editable documents; PDF when the user asks for print-ready or PDF output; XLSX for tabular workbooks; and PPTX for presentations. Only use TXT, Markdown, CSV, or JSON when requested or when that format is clearly the correct deliverable.",
              "Make school documents polished and ready to use: include an appropriate school letterhead or title block, document title, current date in the school's configured format, clear sections, consistent typography, page numbers where useful, and a professional closing or signature area when relevant. Apply the configured logo and brand colors when available, but do not fabricate branding when it is absent.",
              "The workspace includes Node document libraries such as docx, pdf-lib, and pptxgenjs. Use them when needed to generate valid Office or PDF files, and open or validate the generated file before replying.",
            ].join("\n")
          : "You may inspect the available workspace, but you must not modify project files.",
      ].join("\n");
      let providerPrompt = await this.context.build({
        principal: input.principal,
        chatId: chat.id,
        query: input.message,
        identityPrompt,
        activeModule: input.activeModule,
        agentId,
        projectId,
        correlationId,
        attachments:preparedAttachments,
      });
      if (this.config.LEDGERLY_AI_LOG_PROMPTS) {
        this.logger.info(
          { correlationId, chatId: chat.id, jobId, prompt: redactLedgerlyAiText(providerPrompt) },
          "Ledgerly AI prompt",
        );
      } else {
        this.logger.info(
          { correlationId, chatId: chat.id, jobId, promptChars: providerPrompt.length, controller:"ledgerly-ai", directProvider:true },
          "Ledgerly AI request started",
        );
      }

      await progress?.({ type: "running", at: new Date().toISOString(), data: { chatId: chat.id, jobId, correlationId } });
      const progressSeen=new Set<string>();
      let progressSequence=0;
      const onProviderEvent=async(event:ProviderStreamEvent)=>{
        const checkpoint=providerCheckpointFromEvent(event);
        if(checkpoint&&(!providerCheckpoint||providerCheckpoint.provider!==checkpoint.provider||providerCheckpoint.sessionId!==checkpoint.sessionId)){
          providerCheckpoint=checkpoint;
          await this.repository.checkpointJob(input.principal.organizationId,jobId!,checkpoint);
        }
        const readable=humanizeLedgerlyAiProviderEvent(event);
        if(!readable||progressSeen.has(readable.key))return;
        progressSeen.add(readable.key);
        const content=redactLedgerlyAiText(readable.content).trim().slice(0,4000);
        if(!content)return;
        const message=await this.repository.appendMessage({
          principal:input.principal,chatId:chat.id,role:"assistant",content,correlationId,agentId,
          metadata:{
            kind:"progress",jobId,sequence:++progressSequence,progressKind:readable.kind,
            providerEventType:event.type,employeeName:"Ledgerly AI",
          },
        });
        await progress?.({
          type:"message",at:new Date().toISOString(),
          data:{chatId:chat.id,jobId,correlationId,message},
        });
      };
      let providerResult: ProviderResult | null = null;
      let buildVerification:Record<string,unknown>|null=null;
      const toolTrace: Array<Record<string, unknown>> = [];
      const beforeFingerprint=controlsProject?await repositoryFingerprint(this.config.LEDGERLY_AI_REPO_ROOT):null;
      for(let repairAttempt=0;repairAttempt<3;repairAttempt+=1){
        providerResult = await this.providers.execute({
          id: jobId,
          organizationId: input.principal.organizationId,
          userId: input.principal.userId,
          correlationId,
          prompt: providerPrompt,
          taskKind: input.taskKind,
          sandbox:controlsProject?"workspace-write":"read-only",
          workspacePath:controlsProject?this.config.LEDGERLY_AI_REPO_ROOT:undefined,
          providerOverride:providerCheckpoint?.provider??input.provider??undefined,
          sessionId:providerCheckpoint?.sessionId,
          attachmentRoot,
          outputRoot,
          imagePaths:storedFiles.filter(file=>file.mimeType.startsWith("image/")).map(file=>filePaths.get(file.id)!).filter(Boolean),
          onEvent:onProviderEvent,
        });
        if(!controlsProject)break;
        const afterFingerprint=await repositoryFingerprint(this.config.LEDGERLY_AI_REPO_ROOT);
        if(afterFingerprint===beforeFingerprint)break;
        const verification=await rebuildLedgerlyProject(this.config.LEDGERLY_AI_REPO_ROOT);
        buildVerification={ok:verification.ok,summary:verification.summary,attempt:repairAttempt+1};
        if(verification.ok){
          providerResult={...providerResult,text:providerResult.text+"\n\nBuild verification: Web and Node backend builds passed."};
          break;
        }
        if(repairAttempt===2)throw new Error("Ledgerly AI changed the project but could not restore a clean build. "+verification.summary);
        providerPrompt+="\n\n<build_failure>\n"+verification.summary+"\n</build_failure>\nFix these build errors directly, rerun the required builds, and only then provide the final reply.";
      }

      if (!providerResult) throw new Error("Ledgerly AI provider did not return a result.");
      const normalized=normalizeLedgerlyAiResponse(providerResult);
      if (!normalized.content) throw new Error("Ledgerly AI returned an empty response.");

      const generatedFiles:Array<{id:string;name:string;mimeType:string;sizeBytes:number;downloadUrl:string}>=[];
      let generatedTotal=0;
      for(const generatedPath of (await listOutputFiles(outputRoot)).slice(0,10)){
        const info=await stat(generatedPath);if(info.size<=0||info.size>25*1024*1024)continue;generatedTotal+=info.size;if(generatedTotal>50*1024*1024)break;
        const filename=safeFileName(path.basename(generatedPath)),mimeType=outputMime[path.extname(filename).toLowerCase()]||"application/octet-stream",id=createId("laif");
        const objectKey=`ledgerly-ai/${input.principal.organizationId}/outputs/${id}/${filename}`,bytes=new Uint8Array(await readFile(generatedPath));await this.storage.put(objectKey,bytes,mimeType);
        const file=await this.repository.createChatFile({principal:input.principal,id,chatId:chat.id,direction:"output",objectKey,filename,mimeType,sizeBytes:bytes.byteLength});
        generatedFiles.push({id:file.id,name:file.filename,mimeType:file.mimeType,sizeBytes:file.sizeBytes,downloadUrl:`/ledgerly-ai/my/files/${file.id}`});
      }

      const assistantMessage = await this.repository.appendMessage({
        principal: input.principal,
        chatId: chat.id,
        role: "assistant",
        content: normalized.content,
        correlationId,
        agentId,
        metadata: {
          durationMs: normalized.durationMs,
          employeeName:"Ledgerly AI",
          provider: providerResult.provider,
          usage: redactLedgerlyAiValue(providerResult.usage ?? {}),
          toolTrace,
          buildVerification,
          files:generatedFiles,
        },
      });
      await this.repository.bindOutputFiles(input.principal,generatedFiles.map(file=>file.id),assistantMessage.id);

      try {
        await this.memory.captureConversationTurn({
          principal: input.principal,
          chatId: chat.id,
          agentId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          userText: input.message,
          assistantText: normalized.content,
          correlationId,
        });
      } catch (memoryError) {
        this.logger.warn(
          { correlationId, chatId: chat.id, err: memoryError instanceof Error ? memoryError.message : String(memoryError) },
          "Ledgerly AI short-term memory capture failed",
        );
      }

      const response: LedgerlyAiGatewayResponse = {
        chat: {
          id: chat.id,
          title: chat.title,
          agentId,
          employee:null,
        },
        message: {
          id: assistantMessage.id,
          role: "assistant",
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
          metadata:assistantMessage.metadata,
        },
        jobId,
        correlationId,
        durationMs: normalized.durationMs,
      };
      await this.repository.completeJob(input.principal.organizationId, jobId, {
        messageId: assistantMessage.id,
        responseChars: normalized.content.length,
        durationMs: normalized.durationMs,
        controller:"ledgerly-ai",
        toolTrace,
        provider:providerResult.provider,
        providerSessionId:providerResult.sessionId??null,
      });
      if(input.resumeJobId)await this.repository.markJobResumed(input.principal.organizationId,chat.id,input.resumeJobId,jobId);
      await this.repository.audit({
        principal: input.principal,
        action: "ledgerly_ai.response.completed",
        entityType: "chat",
        entityId: chat.id,
        correlationId,
        metadata: {
          jobId,
          taskKind: input.taskKind,
          requestChars: input.message.length,
          responseChars: normalized.content.length,
          activeModule: input.activeModule ?? null,
          agentId,
          controller:"ledgerly-ai",
          projectId,
        },
      });
      await this.idempotency.complete({
        organizationId: input.principal.organizationId,
        userId: input.principal.userId,
        key: input.idempotencyKey,
        response,
      });
      await progress?.({ type: "completed", at: new Date().toISOString(), data: { chatId: chat.id, jobId, correlationId } });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (jobId) await this.repository.failJob(input.principal.organizationId, jobId, message);
      if(jobId&&activeChat){
        const safeError=redactLedgerlyAiText(message).trim().slice(0,800);
        const failureText=`Ledgerly AI stopped before finishing${safeError?`: ${safeError}`:"."} Your conversation has been saved. Select Resume to continue from the last checkpoint.`;
        try{
          const failureMessage=await this.repository.appendMessage({
            principal:input.principal,chatId:activeChat.id,role:"assistant",content:failureText,correlationId,agentId:null,
            metadata:{kind:"failure",jobId,resumable:true,resumeMode:providerCheckpoint?"provider":"context",provider:providerCheckpoint?.provider??input.provider??null,employeeName:"Ledgerly AI"},
          });
          await progress?.({type:"failed",at:new Date().toISOString(),data:{chatId:activeChat.id,jobId,correlationId,message:failureMessage}});
        }catch(failurePersistenceError){
          this.logger.error({correlationId,jobId,err:failurePersistenceError instanceof Error?failurePersistenceError.message:String(failurePersistenceError)},"Ledgerly AI failure status could not be persisted");
        }
      }
      await this.idempotency.fail({
        organizationId: input.principal.organizationId,
        userId: input.principal.userId,
        key: input.idempotencyKey,
        errorCode: error instanceof AppError ? error.code : "FAILED",
      });
      this.logger.warn({ correlationId, jobId, err: redactLedgerlyAiText(message) }, "Ledgerly AI request failed");
      throw error;
    }
  }
}
