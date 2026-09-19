export const LEDGERLY_AI_MEMORY_SCOPES = ["chat","user","agent","organization","project"] as const;
export type LedgerlyAiMemoryScope = (typeof LEDGERLY_AI_MEMORY_SCOPES)[number];

export const LEDGERLY_AI_MEMORY_KINDS = [
  "fact","preference","instruction","task","summary","observation","operational",
] as const;
export type LedgerlyAiMemoryKind = (typeof LEDGERLY_AI_MEMORY_KINDS)[number];

export type LedgerlyAiMemoryRecord = {
  id: string;
  organizationId: string;
  scopeType: LedgerlyAiMemoryScope;
  scopeId: string;
  kind: LedgerlyAiMemoryKind;
  title: string | null;
  content: string;
  importance: number;
  confidence: number;
  sourceType: string;
  sourceId: string | null;
  requiredScope: string | null;
  pinned: boolean;
  correctionOfId: string | null;
  status: "active" | "expired" | "deleted";
  metadata: Record<string, unknown>;
  expiresAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  relevance?: number;
};

export type LedgerlyAiMemoryCreate = {
  scopeType: LedgerlyAiMemoryScope;
  scopeId?: string | null;
  kind?: LedgerlyAiMemoryKind;
  title?: string | null;
  content: string;
  importance?: number;
  confidence?: number;
  sourceType?: string;
  sourceId?: string | null;
  requiredScope?: string | null;
  pinned?: boolean;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
};
