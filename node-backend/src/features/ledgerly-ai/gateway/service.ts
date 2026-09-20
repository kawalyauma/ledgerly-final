import type { Pool } from "pg";
import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import type { LedgerlyAiConfig } from "../config.js";
import type { LedgerlyAiEmployeeRegistry } from "../employees/registry.js";
import type { LedgerlyAiEmployee } from "../employees/types.js";
import { createLedgerlyAiCorrelationId, type LedgerlyAiLogger } from "../logger.js";
import type { LedgerlyAiMemoryService } from "../memory/service.js";
import type { LedgerlyAiProviderRuntime } from "../providers/runtime.js";
import type { LedgerlyAiTaskKind, ProviderResult, ProviderStreamEvent } from "../providers/types.js";
import { humanizeLedgerlyAiProviderEvent } from "../providers/readable-events.js";
import {
  containsLedgerlyAiToolCallMarker,
  ledgerlyAiToolProtocolInstructions,
  parseLedgerlyAiToolCall,
} from "../tools/protocol.js";
import type { LedgerlyAiToolService } from "../tools/service.js";
import type { LedgerlyAiSecurityService } from "../security/service.js";
import { LedgerlyAiContextBuilder } from "./context.js";
import { LedgerlyAiIdempotency } from "./idempotency.js";
import { normalizeLedgerlyAiResponse } from "./normalize.js";
import { LedgerlyAiRateLimiter } from "./rate-limit.js";
import { redactLedgerlyAiText, redactLedgerlyAiValue } from "./redaction.js";
import type { LedgerlyAiGatewayRepository } from "./repository.js";

export type LedgerlyAiGatewayProgress = (event: {
  type: "accepted" | "queued" | "running" | "message" | "waiting_approval" | "completed";
  at: string;
  data?: Record<string, unknown>;
}) => void | Promise<void>;

export type LedgerlyAiAttachment = {
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
  metadata?: Record<string, unknown>;
  attachments?: LedgerlyAiAttachment[];
  idempotencyKey?: string | null;
};

export type LedgerlyAiGatewayResponse = {
  chat: {
    id: string;
    title: string;
    agentId: string | null;
    employee?: { name: string; role: string; icon: string | null } | null;
  };
  message: { id: string; role: "assistant"; content: string; createdAt: string };
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

function publicEmployee(employee: LedgerlyAiEmployee | null) {
  return employee
    ? { name: employee.name, role: employee.role, icon: employee.icon }
    : null;
}

export class LedgerlyAiGatewayService {
  private readonly context: LedgerlyAiContextBuilder;
  private readonly rateLimiter: LedgerlyAiRateLimiter;
  private readonly idempotency: LedgerlyAiIdempotency;

  constructor(
    private readonly repository: LedgerlyAiGatewayRepository,
    private readonly providers: LedgerlyAiProviderRuntime,
    private readonly memory: LedgerlyAiMemoryService,
    private readonly employees: LedgerlyAiEmployeeRegistry,
    private readonly tools: LedgerlyAiToolService,
    private readonly security: LedgerlyAiSecurityService,
    private readonly config: LedgerlyAiConfig,
    db: Pool,
    private readonly logger: LedgerlyAiLogger,
  ) {
    this.context = new LedgerlyAiContextBuilder(repository, memory, config);
    this.rateLimiter = new LedgerlyAiRateLimiter(db, config);
    this.idempotency = new LedgerlyAiIdempotency(db);
  }

  private async resolveEmployee(
    input: LedgerlyAiGatewayRequest,
    chat: { agentId: string | null } | null,
  ) {
    const requested = input.agentId
      ? await this.employees.resolveSelectable(input.principal, input.agentId)
      : null;
    if (!chat) return requested;

    const existing = chat.agentId
      ? await this.employees.resolveSelectable(input.principal, chat.agentId)
      : null;
    if (requested && (!existing || requested.id !== existing.id)) {
      throw new AppError(
        409,
        "LEDGERLY_AI_AGENT_MISMATCH",
        "A chat cannot switch Ledgerly AI employee identity. Start a new chat to use a different employee.",
      );
    }
    return existing;
  }

  async run(input: LedgerlyAiGatewayRequest, progress?: LedgerlyAiGatewayProgress): Promise<LedgerlyAiGatewayResponse> {
    const correlationId = createLedgerlyAiCorrelationId();
    const safeMetadata=await this.security.sanitizeRequestMetadata(input.principal,input.metadata,correlationId);
    const safeAttachments=(input.attachments??[]).map(item=>({
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
      metadata: safeMetadata,
      attachments:safeAttachments,
    });
    const claim = await this.idempotency.claim({
      organizationId: input.principal.organizationId,
      userId: input.principal.userId,
      key: input.idempotencyKey,
      requestHash,
    });
    if (claim.mode === "replay") return claim.response as LedgerlyAiGatewayResponse;

    let jobId: string | undefined;
    try {
      let chat = input.chatId
        ? await this.repository.getChat(input.principal, input.chatId)
        : null;
      const employee = await this.resolveEmployee(input, chat);
      const agentId = employee?.id ?? null;

      await this.rateLimiter.consume({
        organizationId: input.principal.organizationId,
        userId: input.principal.userId,
        agentId,
      });

      if (!chat) {
        chat = await this.repository.createChat({
          principal: input.principal,
          title: input.title?.trim() || titleFromMessage(input.message) || employee?.name || "Ledgerly AI",
          agentId,
          metadata: {
            ...(input.activeModule ? { activeModule: input.activeModule } : {}),
            ...(employee ? { employeeKey: employee.key } : {}),
          },
        });
      }
      if (chat.status !== "active") {
        throw new AppError(409, "LEDGERLY_AI_CHAT_INACTIVE", "This Ledgerly AI chat is not active.");
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
          employeeKey: employee?.key ?? null,
          metadata: safeMetadata,
          attachments:attachmentMeta,
        },
      });
      await progress?.({ type: "queued", at: new Date().toISOString(), data: { chatId: chat.id, jobId, correlationId } });
      await this.repository.startJob(input.principal.organizationId, jobId);

      const catalog = this.tools.catalog(input.principal, employee);
      const toolInstructions = ledgerlyAiToolProtocolInstructions(JSON.stringify(catalog));
      let providerPrompt = await this.context.build({
        principal: input.principal,
        chatId: chat.id,
        query: input.message,
        identityPrompt: this.employees.identityPrompt(employee),
        toolInstructions,
        activeModule: input.activeModule,
        agentId,
        projectId,
        correlationId,
        attachments:safeAttachments,
      });
      if (this.config.LEDGERLY_AI_LOG_PROMPTS) {
        this.logger.info(
          { correlationId, chatId: chat.id, jobId, prompt: redactLedgerlyAiText(providerPrompt) },
          "Ledgerly AI prompt",
        );
      } else {
        this.logger.info(
          { correlationId, chatId: chat.id, jobId, promptChars: providerPrompt.length, employeeKey: employee?.key ?? null, toolCount: catalog.length },
          "Ledgerly AI request started",
        );
      }

      await progress?.({ type: "running", at: new Date().toISOString(), data: { chatId: chat.id, jobId, correlationId } });
      const progressSeen=new Set<string>();
      let progressSequence=0;
      const onProviderEvent=async(event:ProviderStreamEvent)=>{
        const readable=humanizeLedgerlyAiProviderEvent(event);
        if(!readable||progressSeen.has(readable.key))return;
        progressSeen.add(readable.key);
        const content=redactLedgerlyAiText(readable.content).trim().slice(0,4000);
        if(!content)return;
        const message=await this.repository.appendMessage({
          principal:input.principal,chatId:chat.id,role:"assistant",content,correlationId,agentId,
          metadata:{
            kind:"progress",jobId,sequence:++progressSequence,progressKind:readable.kind,
            providerEventType:event.type,employeeKey:employee?.key??null,
            employeeName:employee?.name??"Ledgerly AI",
          },
        });
        await progress?.({
          type:"message",at:new Date().toISOString(),
          data:{chatId:chat.id,jobId,correlationId,message},
        });
      };
      let providerResult: ProviderResult | null = null;
      let pendingApproval: {
        id: string;
        toolCallId: string;
        toolName: string;
        riskLevel: "low" | "medium" | "high" | "critical";
        status: "pending";
        approvalMode?: "single" | "two_step";
        requiredApprovals?: number;
      } | null = null;
      const toolTrace: Array<Record<string, unknown>> = [];

      for (let step = 0; step <= this.config.LEDGERLY_AI_MAX_TOOL_STEPS; step += 1) {
        providerResult = await this.providers.execute({
          id: jobId,
          organizationId: input.principal.organizationId,
          userId: input.principal.userId,
          correlationId,
          prompt: providerPrompt,
          taskKind: input.taskKind,
          sandbox: "read-only",
          onEvent:onProviderEvent,
        });
        const requestedTool = parseLedgerlyAiToolCall(providerResult.text);
        if (!requestedTool) {
          if (containsLedgerlyAiToolCallMarker(providerResult.text)) {
            throw new Error("Ledgerly AI returned a malformed tool request.");
          }
          break;
        }
        if (step >= this.config.LEDGERLY_AI_MAX_TOOL_STEPS) {
          providerResult = await this.providers.execute({
            id: jobId,
            organizationId: input.principal.organizationId,
            userId: input.principal.userId,
            correlationId,
            prompt: providerPrompt + [
              "",
              "<tool_budget_exhausted>",
              "The governed tool budget is exhausted. Do not request another tool.",
              "Use the verified results already supplied to provide the best complete response now.",
              "State any remaining uncertainty or follow-up plainly instead of failing.",
              "</tool_budget_exhausted>",
            ].join("\n"),
            taskKind: input.taskKind,
            sandbox: "read-only",
            onEvent:onProviderEvent,
          });
          break;
        }

        const invocation = await this.tools.invoke({
          principal: input.principal,
          employee,
          toolName: requestedTool.name,
          arguments: requestedTool.arguments,
          correlationId,
          chatId: chat.id,
          jobId,
        });
        if (invocation.status === "waiting_approval") {
          pendingApproval = {
            id: invocation.approvalId,
            toolCallId: invocation.toolCallId,
            toolName: invocation.toolName,
            riskLevel: invocation.riskLevel,
            status: "pending",
            approvalMode: invocation.approvalMode,
            requiredApprovals: invocation.requiredApprovals,
          };
          toolTrace.push({
            toolName: invocation.toolName,
            toolCallId: invocation.toolCallId,
            status: invocation.status,
            approvalId: invocation.approvalId,
            approvalMode: invocation.approvalMode,
            requiredApprovals: invocation.requiredApprovals,
          });
          break;
        }

        const verifiedResult = redactLedgerlyAiValue(invocation.result);
        toolTrace.push({
          toolName: invocation.toolName,
          toolCallId: invocation.toolCallId,
          status: invocation.status,
          durationMs: invocation.durationMs,
        });
        await this.repository.appendMessage({
          principal: input.principal,
          chatId: chat.id,
          role: "tool",
          content: JSON.stringify(verifiedResult),
          correlationId,
          agentId,
          metadata: {
            toolName: invocation.toolName,
            toolCallId: invocation.toolCallId,
            verified: true,
          },
        });
        providerPrompt += [
          "",
          "<verified_tool_result>",
          "tool_name: " + invocation.toolName,
          "tool_call_id: " + invocation.toolCallId,
          JSON.stringify(verifiedResult),
          "</verified_tool_result>",
          "Use this verified Ledgerly result to continue. Call another listed tool only if still necessary.",
        ].join("\n");
      }

      if (!providerResult) throw new Error("Ledgerly AI provider did not return a result.");
      const normalized = pendingApproval
        ? {
            content: (employee?.name ?? "Ledgerly AI") + " prepared an action that requires human approval before Ledgerly can execute it.",
            durationMs: providerResult.durationMs,
          }
        : normalizeLedgerlyAiResponse(providerResult);
      if (!normalized.content) throw new Error("Ledgerly AI returned an empty response.");

      const assistantMessage = await this.repository.appendMessage({
        principal: input.principal,
        chatId: chat.id,
        role: "assistant",
        content: normalized.content,
        correlationId,
        agentId,
        metadata: {
          durationMs: normalized.durationMs,
          employeeKey: employee?.key ?? null,
          employeeName: employee?.name ?? "Ledgerly AI",
          usage: redactLedgerlyAiValue(providerResult.usage ?? {}),
          toolTrace,
          approval: pendingApproval,
        },
      });

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

      if (employee?.kind === "custom") {
        try {
          await this.memory.captureCustomAgentTurn({
            principal: input.principal,
            chatId: chat.id,
            agentId: employee.id,
            memoryScope: employee.memoryScope,
            projectId,
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage.id,
            userText: input.message,
            assistantText: normalized.content,
            correlationId,
          });
        } catch (memoryError) {
          this.logger.warn(
            { correlationId, chatId: chat.id, agentId: employee.id, err: memoryError instanceof Error ? memoryError.message : String(memoryError) },
            "Ledgerly AI custom employee memory capture failed",
          );
        }
      }

      const response: LedgerlyAiGatewayResponse = {
        chat: {
          id: chat.id,
          title: chat.title,
          agentId,
          employee: publicEmployee(employee),
        },
        message: {
          id: assistantMessage.id,
          role: "assistant",
          content: assistantMessage.content,
          createdAt: assistantMessage.createdAt,
        },
        jobId,
        correlationId,
        durationMs: normalized.durationMs,
        ...(pendingApproval ? { approval: pendingApproval } : {}),
      };

      if (pendingApproval) {
        await this.repository.waitingJob(input.principal.organizationId, jobId, {
          messageId: assistantMessage.id,
          approvalId: pendingApproval.id,
          toolCallId: pendingApproval.toolCallId,
          toolName: pendingApproval.toolName,
          riskLevel: pendingApproval.riskLevel,
          approvalMode: pendingApproval.approvalMode,
          requiredApprovals: pendingApproval.requiredApprovals,
        });
        await progress?.({
          type: "waiting_approval",
          at: new Date().toISOString(),
          data: {
            chatId: chat.id, jobId, correlationId, approvalId: pendingApproval.id,
            toolName: pendingApproval.toolName, approvalMode: pendingApproval.approvalMode,
            requiredApprovals: pendingApproval.requiredApprovals,
          },
        });
      } else {
        await this.repository.completeJob(input.principal.organizationId, jobId, {
          messageId: assistantMessage.id,
          responseChars: normalized.content.length,
          durationMs: normalized.durationMs,
          employeeKey: employee?.key ?? null,
          toolTrace,
        });
      }
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
          employeeKey: employee?.key ?? null,
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
