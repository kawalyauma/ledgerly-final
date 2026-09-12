import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const booleanFromEnv = (defaultValue = false) => z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

export const nodeConfigSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  STORAGE_ROOT: z.string().default("./var/storage"),
  ENVIRONMENT: z.enum(["development", "test", "production"]).default("production"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_ISSUER: z.string().default("your-finance-pro"),
  JWT_AUDIENCE: z.string().default("your-finance-pro-api"),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  PG_SSL: booleanFromEnv(false),
  QUEUE_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  QUEUE_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  WHATSAPP_SUPPORT_HUB_URL: optionalString,
  WHATSAPP_SUPPORT_APP_KEY: optionalString,
  WHATSAPP_SUPPORT_WEBHOOK_SECRET: optionalString,
  EGOSMS_API_URL: optionalString,
  EGOSMS_USERNAME: optionalString,
  EGOSMS_PASSWORD: optionalString,
  EGOSMS_SENDER_ID: optionalString,
  RESEND_API_KEY: optionalString,
  RESEND_FROM_EMAIL: optionalString,
  BIOMETRIC_ENCRYPTION_KEY: optionalString,
});

export type NodeConfig = z.infer<typeof nodeConfigSchema>;

export function loadNodeConfig(source: NodeJS.ProcessEnv = process.env): NodeConfig {
  const parsed = nodeConfigSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`).join("; ");
  throw new Error(`Invalid Ledgerly self-hosted configuration: ${details}`);
}
