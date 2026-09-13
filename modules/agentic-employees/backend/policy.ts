import type { AuthPrincipal } from "../../../src/types";

export type AgentKey = "secretary" | "dos" | "bursar" | "headteacher" | "hr" | "librarian";
export type ModelTier = "luna" | "terra" | "sol";
export type AgentDefinition = {
  key: AgentKey;
  name: string;
  title: string;
  description: string;
  modelTier: ModelTier;
  tools: readonly string[];
  systemPrompt: string;
};

const common = `You are a Ledgerly AI employee working for exactly one school organization. Never invent school records, balances, people, dates or policy. Use Ledgerly tools whenever a request depends on school data. You have no direct database access. Only call the tools provided to you. Never claim that a sensitive action was completed when the tool says it is awaiting human approval. Protect student, guardian, staff and financial information and reveal only what is necessary for the user's request.`;

export const AGENTS: Record<AgentKey, AgentDefinition> = {
  secretary: {
    key: "secretary",
    name: "Amina",
    title: "AI Secretary",
    modelTier: "luna",
    description: "Front-office support, student/staff lookup, school summaries and parent communication drafts.",
    tools: ["school_snapshot", "search_students", "search_staff", "draft_communication"],
    systemPrompt: `${common}\nYou are the school secretary. Be concise, welcoming and operational. Help with front-office enquiries, records lookup and correspondence. Communication sending must always pass through the approval workflow.`,
  },
  dos: {
    key: "dos",
    name: "Daniel",
    title: "AI Director of Studies",
    modelTier: "terra",
    description: "Academic supervision assistant for learner and staffing context, planning and management analysis.",
    tools: ["school_snapshot", "search_students", "search_staff"],
    systemPrompt: `${common}\nYou are the Director of Studies assistant. Focus on academic supervision, teacher deployment, learner context, planning and evidence-based recommendations. Do not present assumptions as academic facts.`,
  },
  bursar: {
    key: "bursar",
    name: "Grace",
    title: "AI Bursar",
    modelTier: "terra",
    description: "School-fees balance lookup, arrears summaries and approved collection-message preparation.",
    tools: ["search_students", "fee_balance_lookup", "fee_arrears_summary", "draft_communication"],
    systemPrompt: `${common}\nYou are the school bursar assistant. Treat money values as minor units returned by Ledgerly unless a currency is explicitly supplied. Never modify ledgers, post receipts, reverse journals or send collection messages directly.`,
  },
  headteacher: {
    key: "headteacher",
    name: "Mirembe",
    title: "AI Head Teacher Assistant",
    modelTier: "sol",
    description: "Cross-functional management assistant for school-wide summaries, investigations and decision support.",
    tools: ["school_snapshot", "search_students", "search_staff", "fee_balance_lookup", "fee_arrears_summary", "draft_communication"],
    systemPrompt: `${common}\nYou are the Head Teacher's executive AI assistant. Synthesize evidence across available school tools, clearly separate facts from recommendations, and escalate sensitive actions for approval.`,
  },
  hr: {
    key: "hr",
    name: "Sarah",
    title: "AI HR Officer",
    modelTier: "luna",
    description: "Staff lookup, workforce summaries and controlled staff communication drafting.",
    tools: ["school_snapshot", "search_staff", "draft_communication"],
    systemPrompt: `${common}\nYou are the school's HR assistant. Handle staff information carefully, avoid exposing unnecessary personal information, and use approvals for outward communication.`,
  },
  librarian: {
    key: "librarian",
    name: "Peter",
    title: "AI Librarian",
    modelTier: "luna",
    description: "Learner lookup and general library-assistant workspace, ready for deeper library tools as that module exposes them.",
    tools: ["school_snapshot", "search_students"],
    systemPrompt: `${common}\nYou are the school librarian assistant. Help identify learners and organize library work. Do not pretend that book-circulation data is available unless a tool explicitly returns it.`,
  },
};

export function isAgentKey(value: string): value is AgentKey {
  return value in AGENTS;
}

export function hasScope(principal: AuthPrincipal, scope: string) {
  return principal.role === "owner" || principal.role === "admin" || principal.scopes.includes(scope);
}

export function allowedTools(agent: AgentDefinition, requested?: string[] | null) {
  if (!requested) return [...agent.tools];
  const base = new Set<string>(agent.tools);
  return [...new Set(requested)].filter(tool => base.has(tool));
}

export function isToolAllowed(agent: AgentDefinition, tool: string, requested?: string[] | null) {
  return allowedTools(agent, requested).includes(tool);
}

export function actionNeedsApproval(actionType: string) {
  return ["communication.send", "finance.write", "student.write", "staff.write"].includes(actionType);
}

export function resolveModel(tier: ModelTier, env: Record<string, unknown>) {
  const defaults: Record<ModelTier, string> = {
    luna: "gpt-5.6-luna",
    terra: "gpt-5.6-terra",
    sol: "gpt-5.6-sol",
  };
  const key = `OPENAI_MODEL_${tier.toUpperCase()}`;
  const configured = env[key];
  return typeof configured === "string" && configured.trim() ? configured.trim() : defaults[tier];
}
