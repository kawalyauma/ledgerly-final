export type AgentDocumentFormat = "docx" | "xlsx" | "pptx";

export interface AgentDocumentGenerateInput {
  documentId: string;
  organizationId: string;
  agentKey: string;
  title: string;
  format: AgentDocumentFormat;
  spec: Record<string, unknown>;
}

export interface AgentDocumentArtifact {
  sourceObjectKey: string;
  pdfObjectKey: string;
  sourceMimeType: string;
  sourceSizeBytes: number;
  pdfSizeBytes: number;
  checksumSha256: string;
}

export interface AgentDocumentService {
  generate(input: AgentDocumentGenerateInput): Promise<AgentDocumentArtifact>;
}

export interface Env {
  FINANCE_DB: D1Database;
  REPORTS_BUCKET: R2Bucket;
  WORK_FILES_BUCKET: R2Bucket;
  REPORT_QUEUE: Queue<ReportJobMessage>;
  WEBHOOK_QUEUE: Queue<WebhookJobMessage>;
  WORK_NOTIFICATION_QUEUE: Queue<WorkNotificationJob>;
  COMMUNICATION_QUEUE: Queue<CommunicationJob>;
  ENVIRONMENT: string;
  JWT_SECRET: string;
  JWT_ISSUER: string;
  JWT_AUDIENCE: string;
  SELFHOST_RUNTIME?: "postgresql" | string;
  AGENT_DOCUMENT_SERVICE?: AgentDocumentService;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL_LUNA?: string;
  OPENAI_MODEL_TERRA?: string;
  OPENAI_MODEL_SOL?: string;
  WHATSAPP_SUPPORT_HUB_URL?: string;
  WHATSAPP_SUPPORT_APP_KEY?: string;
  WHATSAPP_SUPPORT_WEBHOOK_SECRET?: string;
  EGOSMS_API_URL?: string;
  EGOSMS_USERNAME?: string;
  EGOSMS_PASSWORD?: string;
  EGOSMS_SENDER_ID?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  BIOMETRIC_ENCRYPTION_KEY?: string;
}

export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  role: "owner" | "admin" | "accountant" | "manager" | "viewer" | "integration";
  scopes: string[];
  /** Present only on short-lived access tokens minted from a revocable mobile offline grant. */
  mobileDeviceId?: string;
}

export interface AppVariables {
  principal: AuthPrincipal;
}

export interface ReportJobMessage {
  kind?: "report";
  jobId: string;
  organizationId: string;
  reportType: string;
  filters: Record<string, string | number | boolean | null>;
  format: "json" | "csv" | "xlsx" | "pdf";
}

export interface WebhookJobMessage { kind:"webhook";deliveryId:string;organizationId:string }

export interface WorkNotificationJob {
  kind: "work-notification";
  deliveryId: string;
  organizationId: string;
  notificationId: string;
  channel: "email" | "sms" | "whatsapp";
  recipient: string;
  subject?: string;
  body: string;
  templateName?: string;
  templateLanguage?: string;
  variables?: string[];
}

export interface CommunicationJob {
  kind: "communication";
  deliveryId: string;
  organizationId: string;
  campaignId: string;
  recipientSnapshotId: string;
  channel: "sms" | "whatsapp";
  recipient: string;
  senderName: string;
  subject: string;
  message: string;
  templateName?: string;
  templateLanguage?: string;
  variables?: string[];
}
