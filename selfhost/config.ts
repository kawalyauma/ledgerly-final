import { z } from "zod";

const optionalSecret=(min:number)=>z.preprocess(
  value=>typeof value==="string"&&!value.trim()?undefined:value,
  z.string().min(min).optional(),
);

const schema=z.object({
  LEDGERLY_HOST:z.string().default("127.0.0.1"),
  LEDGERLY_PORT:z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL:z.string().min(1),
  LEDGERLY_STORAGE_DIR:z.string().default("./data/objects"),
  ENVIRONMENT:z.string().default("production"),
  JWT_SECRET:z.string().min(16),
  JWT_ISSUER:z.string().default("ledgerly"),
  JWT_AUDIENCE:z.string().default("ledgerly-api"),
  OPENAI_API_KEY:z.string().optional(),
  OPENAI_BASE_URL:z.string().url().optional(),
  OPENAI_MODEL_LUNA:z.string().optional(),OPENAI_MODEL_TERRA:z.string().optional(),OPENAI_MODEL_SOL:z.string().optional(),
  // Compose intentionally allows this secret to be omitted on installations
  // that have not configured encrypted AI provider credentials yet. Docker
  // represents an omitted optional value as an empty string, so normalize that
  // empty value to undefined while still enforcing 24+ characters when set.
  AI_PROVIDER_ENCRYPTION_KEY:optionalSecret(24),
  WHATSAPP_SUPPORT_HUB_URL:z.string().optional(),WHATSAPP_SUPPORT_APP_KEY:z.string().optional(),WHATSAPP_SUPPORT_WEBHOOK_SECRET:z.string().optional(),
  EGOSMS_API_URL:z.string().optional(),EGOSMS_USERNAME:z.string().optional(),EGOSMS_PASSWORD:z.string().optional(),EGOSMS_SENDER_ID:z.string().optional(),
  RESEND_API_KEY:z.string().optional(),RESEND_FROM_EMAIL:z.string().optional(),BIOMETRIC_ENCRYPTION_KEY:z.string().optional(),
});
export type SelfhostConfig=z.infer<typeof schema>;
export function loadSelfhostConfig(env:NodeJS.ProcessEnv=process.env){return schema.parse(env);}
