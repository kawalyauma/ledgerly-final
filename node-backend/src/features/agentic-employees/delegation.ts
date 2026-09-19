import type { AuthPrincipal, Env } from "./shared.js";
import { AGENTS, type AgentDefinition, type AgentKey } from "./policy.js";
import type { AgenticLedgerlyAiBridge } from "./ledgerly-ai-bridge.js";

const DELEGATION_TARGETS: Record<AgentKey, AgentKey[]> = {
  secretary: [],
  dos: ["bursar", "secretary", "librarian"],
  bursar: [],
  headteacher: ["dos", "bursar", "hr", "secretary", "librarian"],
  hr: [],
  librarian: [],
};

export async function delegateToEmployee(input: {
  db: D1Database;
  env: Env & Record<string, unknown>;
  principal: AuthPrincipal;
  parentConversationId: string;
  fromAgent: AgentDefinition;
  toAgentKey: AgentKey;
  request: string;
}) {
  const allowed = DELEGATION_TARGETS[input.fromAgent.key] || [];
  if (!allowed.includes(input.toAgentKey)) {
    throw new Error(`${input.fromAgent.key} cannot delegate to ${input.toAgentKey}`);
  }
  if (input.fromAgent.key === input.toAgentKey) {
    throw new Error("An employee cannot delegate work to itself.");
  }
  if (!AGENTS[input.toAgentKey]) throw new Error("Unknown Ledgerly AI employee.");

  const bridge = (input.env as Env & {
    LEDGERLY_AI_AGENTIC_BRIDGE?: AgenticLedgerlyAiBridge;
  }).LEDGERLY_AI_AGENTIC_BRIDGE;
  if (!bridge) throw new Error("Ledgerly AI delegation bridge is unavailable.");

  return bridge.delegateLegacy(input);
}
