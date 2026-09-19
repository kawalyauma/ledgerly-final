import { AppError } from "./shared.js";
import type { Env } from "./shared.js";
import type { ModelTier } from "./policy.js";
import type { AgenticLedgerlyAiBridge, AgenticRunInput } from "./ledgerly-ai-bridge.js";

type BridgeEnv = Env & Record<string, unknown> & {
  LEDGERLY_AI_AGENTIC_BRIDGE?: AgenticLedgerlyAiBridge;
};

function bridge(env: BridgeEnv) {
  if (!env.LEDGERLY_AI_AGENTIC_BRIDGE) {
    throw new AppError(503, "LEDGERLY_AI_UNAVAILABLE", "Ledgerly AI is not available for Agentic Employees.");
  }
  return env.LEDGERLY_AI_AGENTIC_BRIDGE;
}

export async function runAgent(input: AgenticRunInput) {
  return bridge(input.env as BridgeEnv).runAgent(input);
}

export async function testProviderConnection(
  _db: D1Database,
  env: BridgeEnv,
  _organizationId: string,
  _tier: ModelTier = "luna",
) {
  return bridge(env).testConnection();
}
