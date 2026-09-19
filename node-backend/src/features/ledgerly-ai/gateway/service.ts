import type { Pool } from "pg";
import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import type { LedgerlyAiConfig } from "../config.js";
import type { LedgerlyAiEmployeeRegistry } from "../employees/registry.js";
import type { LedgerlyAiEmployee } from "../employees/types.js";
import { createLedgerlyAiCorrelationId, type LedgerlyAiLogger } from "../logger.js";
import type { LedgerlyAiMemoryService } from "../memory/service.js";
import type { LedgerlyAiProviderRuntime } from "../providers/runtime.js";
import type { LedgerlyAiTaskKind } from "../providers/types.js";
import { LedgerlyAiContextBuilder } from "./context.js";
import { LedgerlyAiIdempotency } from "./idempotency.js";
import { normalizeLedgerlyAiResponse } from "./normalize.js";
import { LedgerlyAiRateLimiter } from "./rate-limit.js";
import { redactLedgerlyAiText, redactLedgerlyAiValue } from "./redaction.js";
import type { LedgerlyAiGatewayRepository } from "./repository.js";

export type LedgerlyAiGatewayProgress = (event: {
  type: "accepted" | "queued" | "running" | "completed";
  at: string;
  data?: Record<string, unknown>;
}) => void | Promise<void>;

export type LedgerlyAiGatewayRequest = {
  principal: AuthPrincipal;
  message: string;
  chatId?: string;
  agentId?: string | null;
  title?: string;
  activeModule?: string | null;
  taskKind: LedgerlyAiTaskKind;
  metadata?: Record<string, unknown>;
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
    const requestHash = this.idempotency.hash({
      message: input.message,
      chatId: input.chatId ?? null,
      agentId: input.agentId ?? null,
      activeModule: input.activeModule ?? null,
      taskKind: input.taskKind,
      metadata: redactLedgerlyAiValue(input.metadata ?? {}),
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

      const projectId = projectIdFromMetadata(input.metadata);
      await progress?.({ type: "accepted", at: new Date().toISOString(), data: { chatId: chat.id, correlationId } });
      const userMessage = await this.repository.appendMessage({
        principal: input.principal,
        chatId: chat.id,
        role: "user",
        content: input.message,
        correlationId,
        agentId,
        metadata: redactLedgerlyAiValue(input.metadata ?? {}) as Record<string, unknown>,
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
          metadata: redactLedgerlyAiValue(input.metadata ?? {}),
        },
      });
      await progress?.({ type: "queued", at: new Date().toISOString(), data: { chatId: chat.id, jobId, correlationId } });
      await this.repository.startJob(input.principal.organizationId, jobId);

      const providerPrompt = await this.context.build({
        principal: input.principal,
        chatId: chat.id,
        query: input.message,
        identityPrompt: this.employees.identityPrompt(employee),
        activeModule: input.activeModule,
        agentId,
        projectId,
        correlationId,
      });
      if (this.config.LEDGERLY_AI_LOG_PROMPTS) {
        this.logger.info(
          { correlationId, chatId: chat.id, jobId, prompt: redactLedgerlyAiText(providerPrompt) },
          "Ledgerly AI prompt",
        );
      } else {
        this.logger.info(
          { correlationId, chatId: chat.id, jobId, promptChars: providerPrompt.length, employeeKey: employee?.key ?? null },
          "Ledgerly AI request started",
        );
      }

      await progress?.({ type: "running", at: new Date().toISOString(), data: { chatId: chat.id, jobId, correlationId } });
      const providerResult = await this.providers.execute({
        id: jobId,
        organizationId: input.principal.organizationId,
        userId: input.principal.userId,
        correlationId,
        prompt: providerPrompt,
        taskKind: input.taskKind,
        sandbox: "read-only",
      });
      const normalized = normalizeLedgerlyAiResponse(providerResult);
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
          usage: redactLedgerlyAiValue(providerResult.usage ?? {}),
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
      };

      await this.repository.completeJob(input.principal.organizationId, jobId, {
        messageId: assistantMessage.id,
        responseChars: normalized.content.length,
        durationMs: normalized.durationMs,
        employeeKey: employee?.key ?? null,
      });
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
