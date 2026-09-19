import type { LedgerlyAiProviderId } from "./config.js";

export type LedgerlyAiId = string;
export type LedgerlyAiMessageRole = "system" | "user" | "assistant" | "tool";
export type LedgerlyAiChatStatus = "active" | "archived" | "deleted";
export type LedgerlyAiAgentKind = "built-in" | "custom" | "engineering";
export type LedgerlyAiAgentStatus = "draft" | "testing" | "active" | "paused" | "disabled";
export type LedgerlyAiJobStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";
export type LedgerlyAiRiskLevel = "low" | "medium" | "high" | "critical";
export type LedgerlyAiApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "executed";
export type LedgerlyAiIncidentStatus =
  | "open"
  | "investigating"
  | "fixing"
  | "testing"
  | "staging"
  | "awaiting_approval"
  | "deployed"
  | "verified"
  | "closed"
  | "failed";

export type LedgerlyAiPromptRequest = {
  organizationId: string;
  userId: string;
  message: string;
  chatId?: string;
  agentId?: string;
  correlationId: string;
  metadata?: Record<string, unknown>;
};

export type LedgerlyAiMessage = {
  id: LedgerlyAiId;
  organizationId: string;
  chatId: string;
  role: LedgerlyAiMessageRole;
  content: string;
  userId?: string | null;
  agentId?: string | null;
  correlationId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type LedgerlyAiChat = {
  id: LedgerlyAiId;
  organizationId: string;
  createdBy: string;
  agentId?: string | null;
  title: string;
  status: LedgerlyAiChatStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
};

export type LedgerlyAiAgent = {
  id: LedgerlyAiId;
  organizationId: string;
  key: string;
  displayName: string;
  role: string;
  description: string;
  icon?: string | null;
  avatar: Record<string, unknown>;
  visibility: "all" | "staff" | "admin";
  kind: LedgerlyAiAgentKind;
  status: LedgerlyAiAgentStatus;
  permissions: string[];
  capabilities: string[];
  toolAllowlist: string[];
  memoryScope: "chat" | "user" | "agent" | "organization" | "project";
  templateVersion: number;
  metadata: Record<string, unknown>;
};

export type LedgerlyAiJob = {
  id: LedgerlyAiId;
  organizationId: string;
  kind: string;
  agentId?: string | null;
  chatId?: string | null;
  createdBy: string;
  status: LedgerlyAiJobStatus;
  riskLevel: LedgerlyAiRiskLevel;
  correlationId: string;
  input: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
};

export type LedgerlyAiToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiredScopes: string[];
  riskLevel: LedgerlyAiRiskLevel;
  approvalRequired: boolean;
};

export type LedgerlyAiMemory = {
  id: LedgerlyAiId;
  organizationId: string;
  scopeType: "chat" | "user" | "agent" | "organization" | "project";
  scopeId: string;
  kind: "fact" | "preference" | "instruction" | "task" | "summary" | "observation" | "operational";
  title?: string | null;
  content: string;
  importance: number;
  confidence: number;
  sourceType: string;
  sourceId?: string | null;
  requiredScope?: string | null;
  pinned: boolean;
  correctionOfId?: string | null;
  status: "active" | "expired" | "deleted";
  metadata: Record<string, unknown>;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
  useCount: number;
};

export type LedgerlyAiProviderExecution = {
  id: LedgerlyAiId;
  organizationId: string;
  jobId?: string | null;
  provider: LedgerlyAiProviderId;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  correlationId: string;
  startedAt?: string | null;
  completedAt?: string | null;
  exitCode?: number | null;
  error?: string | null;
  metadata: Record<string, unknown>;
};

export type LedgerlyAiIncident = {
  id: LedgerlyAiId;
  organizationId?: string | null;
  fingerprint: string;
  source: string;
  signalType?: string | null;
  title: string;
  severity: LedgerlyAiRiskLevel;
  status: LedgerlyAiIncidentStatus;
  assignedAgentId?: string | null;
  assignedAgentKey?: string | null;
  correlationId?: string | null;
  context: Record<string, unknown>;
  latestContext?: Record<string, unknown>;
  occurrenceCount?: number;
  moduleKey?: string | null;
  errorCode?: string | null;
  httpStatus?: number | null;
  branchName?: string | null;
  workspacePath?: string | null;
  baseSha?: string | null;
  fixSha?: string | null;
  changeRisk?: LedgerlyAiRiskLevel | null;
  productionApprovalId?: string | null;
  detectedAt?: string;
  lastSeenAt?: string;
  verifiedAt?: string | null;
  closedAt?: string | null;
  lastTimelineEventAt?: string | null;
  lastDispatchAt?: string | null;
  suppressedSignalCount?: number;
  regressionOfIncidentId?: string | null;
};

export type LedgerlyAiApproval = {
  id: LedgerlyAiId;
  organizationId: string;
  requestedBy: string;
  actionType: string;
  riskLevel: LedgerlyAiRiskLevel;
  status: LedgerlyAiApprovalStatus;
  payload: Record<string, unknown>;
  reviewedBy?: string | null;
  reviewNote?: string | null;
};

export type LedgerlyAiAuditEvent = {
  id: LedgerlyAiId;
  organizationId?: string | null;
  actorType: "user" | "agent" | "system";
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  correlationId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
