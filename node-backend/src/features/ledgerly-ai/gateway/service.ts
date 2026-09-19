import type { Pool } from "pg";
import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import type { LedgerlyAiConfig } from "../config.js";
import { createLedgerlyAiCorrelationId, type LedgerlyAiLogger } from "../logger.js";
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
  chat: { id: string; title: string; agentId: string | null };
  message: { id: string; role: "assistant"; content: string; createdAt: string };
  jobId: string;
  correlationId: string;
  durationMs: number;
};

function titleFromMessage(message: string) {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

export class LedgerlyAiGatewayService {
  private readonly context: LedgerlyAiContextBuilder;
  private readonly rateLimiter: LedgerlyAiRateLimiter;
  private readonly idempotency: LedgerlyAiIdempotency;

  constructor(
    private readonly repository: LedgerlyAiGatewayRepository,
    private readonly providers: LedgerlyAiProviderRuntime,
    private readonly config: LedgerlyAiConfig,
    db: Pool,
    private readonly logger: LedgerlyAiLogger,
  ) {
    this.context = new LedgerlyAiContextBuilder(repository, config);
    this.rateLimiter = new LedgerlyAiRateLimiter(db, config);
    this.idempotency = new LedgerlyAiIdempotency(db);
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
      await this.rateLimiter.consume({
        organizationId: input.principal.organizationId,
        userId: input.principal.userId,
        agentId: input.agentId,
      });

      const chat = input.chatId
        ? await this.repository.getChat(input.principal, input.chatId)
        : await this.repository.createChat({
            principal: input.principal,
            title: input.title?.trim() || titleFromMessage(input.message) || "Ledgerly AI",
            agentId: input.agentId,
            metadata: input.activeModule ? { activeModule: input.activeModule } : {},
          });
      if (chat.status !== "active") throw new AppError(409, "LEDGERLY_AI_CHAT_INACTIVE", "This Ledgerly AI chat is not active.");
      const agentId = input.agentId ?? chat.agentId;

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
          metadata: redactLedgerlyAiValue(input.metadata ?? {}),
        },
      });
      await progress?.({ type: "queued", at: new Date().toISOString(), data: { chatId: chat.id, jobId, correlationId } });
      await this.repository.startJob(input.principal.organizationId, jobId);

      const providerPrompt = await this.context.build({
        principal: input.principal,
        chatId: chat.id,
        activeModule: input.activeModule,
        agentId,
      });
      if (this.config.LEDGERLY_AI_LOG_PROMPTS) {
        this.logger.info(
          { correlationId, chatId: chat.id, jobId, prompt: redactLedgerlyAiText(providerPrompt) },
          "Ledgerly AI prompt",
        );
      } else {
        this.logger.info(
          { correlationId, chatId: chat.id, jobId, promptChars: providerPrompt.length },
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
          usage: redactLedgerlyAiValue(providerResult.usage ?? {}),
        },
      });
      const response: LedgerlyAiGatewayResponse = {
        chat: { id: chat.id, title: chat.title, agentId },
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
