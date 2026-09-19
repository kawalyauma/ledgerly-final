import type { LedgerlyAiMemoryScope } from "../memory/types.js";

export type LedgerlyAiEmployeeVisibility = "all" | "staff" | "admin";

export type LedgerlyAiEmployee = {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  role: string;
  description: string;
  icon: string | null;
  avatar: Record<string, unknown>;
  visibility: LedgerlyAiEmployeeVisibility;
  permissions: string[];
  effectivePermissions: string[];
  capabilities: string[];
  tools: string[];
  memoryScope: LedgerlyAiMemoryScope;
  status: "draft" | "testing" | "active" | "paused" | "disabled";
  kind: "built-in" | "custom" | "engineering";
  templateVersion: number;
  metadata: Record<string, unknown>;
};
