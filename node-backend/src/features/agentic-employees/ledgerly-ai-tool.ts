import { z } from "zod";
import type { LedgerlyAiToolDefinition } from "../ledgerly-ai/tools/types.js";
import type { AgenticLedgerlyAiBridge } from "./ledgerly-ai-bridge.js";
import type { Env } from "./shared.js";

export function createLegacyEmployeeDelegationTool(
  bridge: AgenticLedgerlyAiBridge,
  db: D1Database,
  env: Env & Record<string, unknown>,
): LedgerlyAiToolDefinition {
  return {
    name: "agent.delegate.legacy",
    category: "work",
    description: "Delegate one read-only school subtask to Amina, Daniel, Grace, Mirembe, Sarah, or Peter and return the verified findings.",
    inputSchema: z.object({
      employee: z.enum(["secretary","dos","bursar","headteacher","hr","librarian"]),
      request: z.string().trim().min(3).max(12000),
    }),
    inputJsonSchema: {
      type: "object",
      properties: {
        employee: { type: "string", enum: ["secretary","dos","bursar","headteacher","hr","librarian"] },
        request: { type: "string" },
      },
      required: ["employee","request"],
      additionalProperties: false,
    },
    requiredScopes: ["school:read"],
    riskLevel: "low",
    approvalRequired: false,
    mutating: false,
    async execute(ctx, input) {
      if (ctx.employee?.key !== "amani") {
        throw new Error("This delegation tool is reserved for Amani.");
      }
      return bridge.delegateFromAmani({
        db,
        env,
        principal: ctx.principal,
        toAgentKey: input.employee,
        request: input.request,
        parentChatId: ctx.chatId ?? null,
        parentJobId: ctx.jobId ?? null,
      });
    },
  };
}
