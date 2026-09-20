import type { LedgerlyAiProviderId } from "../config.js";

export type LedgerlyAiTaskKind =
  | "chat" | "analysis" | "report" | "research"
  | "code" | "engineering" | "testing" | "operations";

export type LedgerlyAiSandbox = "read-only" | "workspace-write";

export type ProviderRequest = {
  id: string;
  organizationId: string;
  userId: string;
  correlationId: string;
  prompt: string;
  taskKind: LedgerlyAiTaskKind;
  workspacePath?: string;
  imagePaths?: string[];
  sessionId?: string;
  sandbox?: LedgerlyAiSandbox;
  maxTurns?: number;
  timeoutMs?: number;
  onEvent?: (event: ProviderStreamEvent) => void | Promise<void>;
};

export type ProviderStreamEvent = {
  at: string;
  stream: "stdout" | "stderr" | "system";
  type: string;
  data: unknown;
  raw?: string;
};

export type ProviderResult = {
  provider: LedgerlyAiProviderId;
  text: string;
  sessionId?: string;
  durationMs: number;
  exitCode: number;
  events: ProviderStreamEvent[];
  usage?: Record<string, unknown>;
};

export type ProviderHealth = {
  provider: LedgerlyAiProviderId;
  available: boolean;
  executable: boolean;
  sessionConfigured: boolean;
  checkedAt: string;
  latencyMs: number;
  detail?: string;
};

export type ProviderDiagnostics = ProviderHealth & {
  active: number;
  queued: number;
  jobsLastHour: number;
  successesLastHour: number;
  failuresLastHour: number;
  successRate: number | null;
  averageDurationMs: number | null;
  softJobsPerHour: number;
};

export interface LedgerlyAiProviderAdapter {
  readonly id: LedgerlyAiProviderId;
  readonly capabilities: ReadonlySet<LedgerlyAiTaskKind>;
  health(): Promise<ProviderHealth>;
  execute(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult>;
}
