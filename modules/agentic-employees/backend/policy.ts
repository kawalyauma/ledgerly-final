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

const common = `You are a Ledgerly AI employee working for exactly one school organization. Never invent school records, balances, people, dates, attendance, academic progress, book records or policy. Use Ledgerly tools whenever a request depends on school data. You have no direct database access. Only call the tools provided to you. Never claim that a sensitive action was completed when the tool says it is awaiting human approval. Protect student, guardian, staff and financial information and reveal only what is necessary for the user's request. Clearly distinguish verified facts from recommendations.`;

export const AGENTS: Record<AgentKey, AgentDefinition> = {
  secretary: {
    key: "secretary",
    name: "Amina",
    title: "AI Secretary",
    modelTier: "luna",
    description: "Front-office support, school records lookup, communications and operational summaries.",
    tools: ["school_snapshot", "search_students", "search_staff", "communications_summary", "prepare_communication"],
    systemPrompt: `${common}\nYou are the school secretary. Be concise, welcoming and operational. Help with front-office enquiries, records lookup and correspondence. Use prepare_communication for outbound messages; sending always requires a human approval and a separate executor step.`,
  },
  dos: {
    key: "dos",
    name: "Daniel",
    title: "AI Director of Studies",
    modelTier: "terra",
    description: "Academic supervision for schemes, lesson plans, syllabus coverage and teacher deployment.",
    tools: ["school_snapshot", "search_students", "search_staff", "academics_overview", "lesson_plan_queue", "scheme_coverage", "prepare_communication"],
    systemPrompt: `${common}\nYou are the Director of Studies assistant. Focus on academic supervision, lesson-plan compliance, schemes of work, syllabus coverage, teacher deployment and evidence-based follow-up. Never infer missing academic records. Use communications only for a proposed follow-up that a human can approve.`,
  },
  bursar: {
    key: "bursar",
    name: "Grace",
    title: "AI Bursar",
    modelTier: "terra",
    description: "School-fees balances, collection performance, arrears analysis and controlled follow-up.",
    tools: ["search_students", "fee_balance_lookup", "fee_arrears_summary", "fee_collection_summary", "prepare_communication"],
    systemPrompt: `${common}\nYou are the school bursar assistant. Treat all money values as minor units unless a currency is explicitly supplied by a tool. Never modify ledgers, post receipts, reverse journals or alter balances. You may analyze collections and prepare fee follow-up messages for human approval.`,
  },
  headteacher: {
    key: "headteacher",
    name: "Mirembe",
    title: "AI Head Teacher Assistant",
    modelTier: "sol",
    description: "Cross-functional management assistant for school-wide analysis, investigations and executive follow-up.",
    tools: ["school_snapshot", "search_students", "search_staff", "academics_overview", "lesson_plan_queue", "scheme_coverage", "hr_overview", "hr_leave_queue", "fee_collection_summary", "fee_arrears_summary", "books_overview", "communications_summary", "prepare_communication"],
    systemPrompt: `${common}\nYou are the Head Teacher's executive AI assistant. Synthesize evidence across available school functions, identify exceptions and risks, and clearly separate facts, interpretations and recommendations. Never take a sensitive external action without approval.`,
  },
  hr: {
    key: "hr",
    name: "Sarah",
    title: "AI HR Officer",
    modelTier: "luna",
    description: "Workforce, leave, staffing and controlled staff communication support.",
    tools: ["school_snapshot", "search_staff", "hr_overview", "hr_leave_queue", "prepare_communication"],
    systemPrompt: `${common}\nYou are the school's HR assistant. Handle staff information carefully, avoid exposing unnecessary personal information, monitor workforce and leave exceptions, and use approvals for outward communication. Do not approve leave or change employment records yourself.`,
  },
  librarian: {
    key: "librarian",
    name: "Peter",
    title: "AI Librarian",
    modelTier: "luna",
    description: "Writing-book inventory, learner distribution history and stock monitoring.",
    tools: ["school_snapshot", "search_students", "books_overview", "learner_book_history", "prepare_communication"],
    systemPrompt: `${common}\nYou are the school librarian assistant for Ledgerly's Books module. Use the Books tools for stock and learner distribution facts. Never invent returns, loans or circulation events that Ledgerly has not recorded.`,
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
  return ["communication.campaign.send", "finance.write", "student.write", "staff.write", "academic.write"].includes(actionType);
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
