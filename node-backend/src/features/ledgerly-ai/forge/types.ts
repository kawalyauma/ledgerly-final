import { z } from "zod";
import { LEDGERLY_AI_MEMORY_SCOPES } from "../memory/types.js";

export const FORGE_ACCESS_MODES = ["read_only","governed_actions","allowed_actions"] as const;
export const FORGE_TONE_STYLES = ["professional","friendly","concise","analytical","teacher_like","custom"] as const;

export const forgeTriggerSchema = z.object({
  type: z.enum(["manual","schedule","event"]),
  label: z.string().trim().min(1).max(160),
  schedule: z.string().trim().max(240).nullable().optional(),
  eventKey: z.string().trim().max(160).nullable().optional(),
  enabled: z.boolean().default(true),
});

export const forgeCommunicationsSchema = z.object({
  enabled: z.boolean().default(false),
  channels: z.array(z.enum(["sms","whatsapp","email","in_app"])).max(4).default([]),
  recipientPolicy: z.string().trim().max(500).default("Only recipients explicitly permitted by the initiating user and Ledgerly policy."),
});

export const forgeApprovalRulesSchema = z.object({
  mode: z.enum(["always_for_writes","risk_based","custom"]).default("always_for_writes"),
  requireApprovalFor: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  notes: z.string().trim().max(2000).default(""),
});

export const forgeToneSchema = z.object({
  style: z.enum(FORGE_TONE_STYLES).default("professional"),
  instructions: z.string().trim().max(2000).default(""),
});

export const forgeAgentSpecSchema = z.object({
  name: z.string().trim().max(80).default(""),
  role: z.string().trim().max(140).default(""),
  purpose: z.string().trim().max(1200).default(""),
  description: z.string().trim().max(2000).default(""),
  responsibilities: z.array(z.string().trim().min(1).max(500)).max(40).default([]),
  capabilities: z.array(z.string().trim().min(1).max(120)).max(60).default([]),
  tools: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  permissions: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  accessMode: z.enum(FORGE_ACCESS_MODES).default("read_only"),
  memoryScope: z.enum(LEDGERLY_AI_MEMORY_SCOPES).default("user"),
  triggers: z.array(forgeTriggerSchema).max(30).default([]),
  communications: forgeCommunicationsSchema.default({
    enabled:false,channels:[],recipientPolicy:"Only recipients explicitly permitted by the initiating user and Ledgerly policy.",
  }),
  approvalRules: forgeApprovalRulesSchema.default({
    mode:"always_for_writes",requireApprovalFor:[],notes:"",
  }),
  tone: forgeToneSchema.default({style:"professional",instructions:""}),
  visibility: z.enum(["all","staff","admin"]).default("staff"),
  icon: z.string().trim().max(80).default("bot"),
});

export type ForgeAgentSpec = z.infer<typeof forgeAgentSpecSchema>;
export type ForgeTrigger = z.infer<typeof forgeTriggerSchema>;

export type ForgeBuilderStatus =
  | "collecting"
  | "review"
  | "testing"
  | "ready"
  | "activated"
  | "closed";

export type ForgeBuilderSession = {
  id: string;
  organizationId: string;
  createdBy: string;
  forgeChatId: string | null;
  operation: "create" | "clone" | "revise";
  status: ForgeBuilderStatus;
  spec: ForgeAgentSpec;
  missingFields: string[];
  readinessScore: number;
  proposedAgentId: string | null;
  sourceAgentId: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ForgePreview = {
  ready: boolean;
  readinessScore: number;
  missingFields: string[];
  employee: {
    name: string;
    role: string;
    purpose: string;
    description: string;
    responsibilities: string[];
    capabilities: string[];
  };
  authority: {
    accessMode: ForgeAgentSpec["accessMode"];
    permissions: string[];
    tools: string[];
    memoryScope: ForgeAgentSpec["memoryScope"];
    approvalMode: ForgeAgentSpec["approvalRules"]["mode"];
  };
  automation: {
    triggers: ForgeAgentSpec["triggers"];
    communications: ForgeAgentSpec["communications"];
  };
  style: ForgeAgentSpec["tone"];
  warnings: string[];
};
