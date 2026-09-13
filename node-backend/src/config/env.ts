import { z } from "zod";

function envBoolean(defaultValue: boolean) {
  return z.union([z.boolean(), z.enum(["true", "false"])]).optional().transform((value) => {
    if (value === undefined) return defaultValue;
    return typeof value === "boolean" ? value : value === "true";
  });
}

function envList(defaultValue: string[] = []) {
  return z.string().optional().transform((value) => {
    if (value === undefined) return defaultValue;
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  });
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  DATABASE_SSL: envBoolean(false),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  STORAGE_DRIVER: z.enum(["local", "minio"]).default("local"),
  STORAGE_LOCAL_ROOT: z.string().min(1).default("./data/storage"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).default("ledgerly"),
  S3_FORCE_PATH_STYLE: envBoolean(true),
  S3_AUTO_CREATE_BUCKET: envBoolean(true),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default("your-finance-pro"),
  JWT_AUDIENCE: z.string().min(1).default("your-finance-pro-api"),
  CORS_ORIGINS: z.string().default("http://localhost:5173").transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),
  QUEUE_POLL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  QUEUE_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  QUEUE_STALE_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
  SCHEDULER_TIMEZONE: z.string().min(1).default("Africa/Kampala"),
  EGOSMS_URL: z.string().url().default("https://www.egosms.co/api/v1/plain/"),
  EGOSMS_USERNAME: z.string().min(1).optional(),
  EGOSMS_PASSWORD: z.string().min(1).optional(),
  EGOSMS_SENDER_ID: z.string().min(1).max(20).optional(),
  WHATSAPP_SUPPORT_HUB_URL: z.string().url().optional(),
  WHATSAPP_SUPPORT_APP_KEY: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
  SCHOOLPAY_API_BASE_URL: z.string().url().default("https://schoolpay.co.ug"),
  SCHOOLPAY_PUBLIC_BASE_URL: z.string().url().optional(),
  SCHOOLPAY_SECRET_ENCRYPTION_KEY: z.string().min(32).optional(),
  SCHOOLPAY_ENFORCE_WEBHOOK_IP_ALLOWLIST: envBoolean(false),
  SCHOOLPAY_WEBHOOK_IP_ALLOWLIST: envList(),
  SCHOOLPAY_TRUSTED_PROXY_IPS: envList(["127.0.0.1", "::1"]),
}).superRefine((value, ctx) => {
  if (value.STORAGE_DRIVER === "minio") {
    for (const key of ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const) {
      if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when STORAGE_DRIVER=minio` });
    }
  }
  if (value.SCHOOLPAY_ENFORCE_WEBHOOK_IP_ALLOWLIST && value.SCHOOLPAY_WEBHOOK_IP_ALLOWLIST.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["SCHOOLPAY_WEBHOOK_IP_ALLOWLIST"],
      message: "SCHOOLPAY_WEBHOOK_IP_ALLOWLIST must contain at least one IP/CIDR when enforcement is enabled",
    });
  }
});

export type AppConfig = z.infer<typeof schema>;
export function parseEnv(env: NodeJS.ProcessEnv | Record<string, unknown> = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid Ledgerly Node backend environment: ${details}`);
  }
  return parsed.data;
}
