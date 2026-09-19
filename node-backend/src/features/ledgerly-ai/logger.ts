import { randomUUID } from "node:crypto";
import type { Logger } from "../../lib/logger.js";

export type LedgerlyAiLogContext = {
  correlationId?: string;
  organizationId?: string;
  userId?: string;
  agentId?: string;
  jobId?: string;
  incidentId?: string;
};

export function createLedgerlyAiLogger(base: Logger, context: LedgerlyAiLogContext = {}) {
  return base.child({ subsystem: "ledgerly-ai", ...context });
}

export type LedgerlyAiLogger = ReturnType<typeof createLedgerlyAiLogger>;

export function createLedgerlyAiCorrelationId(prefix = "lai") {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
