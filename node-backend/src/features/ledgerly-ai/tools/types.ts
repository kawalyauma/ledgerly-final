import type { z } from "zod";
import type { AuthPrincipal } from "../../../http/types.js";
import type { Runtime } from "../../../runtime.js";
import type { LedgerlyAiConfig } from "../config.js";
import type { LedgerlyAiEmployee } from "../employees/types.js";
import type { LedgerlyAiRiskLevel } from "../types.js";

export type LedgerlyAiToolCategory =
  | "school"
  | "attendance"
  | "academics"
  | "finance"
  | "payroll"
  | "reporting"
  | "database"
  | "work"
  | "repository"
  | "testing"
  | "operations";

export type LedgerlyAiToolContext = {
  runtime: Runtime;
  config: LedgerlyAiConfig;
  principal: AuthPrincipal;
  employee: LedgerlyAiEmployee | null;
  correlationId: string;
  chatId?: string | null;
  jobId?: string | null;
  approvalId?: string | null;
  approvedBy?: string | null;
};

export type LedgerlyAiToolDefinition<TSchema extends z.ZodType = z.ZodType> = {
  name: string;
  category: LedgerlyAiToolCategory;
  description: string;
  inputSchema: TSchema;
  inputJsonSchema: Record<string, unknown>;
  requiredScopes: string[];
  scopeMode?: "all" | "any";
  riskLevel: LedgerlyAiRiskLevel;
  approvalRequired: boolean;
  mutating: boolean;
  productionAction?: boolean;
  destructive?: boolean;
  execute: (context: LedgerlyAiToolContext, input: z.infer<TSchema>) => Promise<unknown>;
};

export type LedgerlyAiToolCatalogItem = {
  name: string;
  category: LedgerlyAiToolCategory;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScopes: string[];
  scopeMode: "all" | "any";
  riskLevel: LedgerlyAiRiskLevel;
  approvalRequired: boolean;
  mutating: boolean;
  productionAction: boolean;
  destructive: boolean;
};

export type LedgerlyAiToolInvocationResult =
  | {
      status: "succeeded";
      toolCallId: string;
      toolName: string;
      result: unknown;
      durationMs: number;
    }
  | {
      status: "waiting_approval";
      toolCallId: string;
      toolName: string;
      approvalId: string;
      riskLevel: LedgerlyAiRiskLevel;
      requiredScopes: string[];
      approvalMode: "single" | "two_step";
      requiredApprovals: number;
    };
