import type { Env } from "../types";
import type { NodeConfig } from "./config";
import { LocalR2Bucket } from "./local-r2";
import { PostgresD1Database } from "./postgres-d1";
import { PostgresQueue } from "./queue";

export type NodeRuntime = { env: Env; db: PostgresD1Database };

export function createNodeRuntime(config: NodeConfig): NodeRuntime {
  const db = new PostgresD1Database(config.DATABASE_URL, { max: config.PG_POOL_MAX, ssl: config.PG_SSL });
  const queue = <T>(name: string, attempts: number) => new PostgresQueue<T>(db, name, attempts) as unknown as Queue<T>;
  const env: Env = {
    FINANCE_DB: db as unknown as D1Database,
    REPORTS_BUCKET: new LocalR2Bucket(`${config.STORAGE_ROOT}/reports`) as unknown as R2Bucket,
    WORK_FILES_BUCKET: new LocalR2Bucket(`${config.STORAGE_ROOT}/work-files`) as unknown as R2Bucket,
    REPORT_QUEUE: queue("finance-report-jobs", 5), WEBHOOK_QUEUE: queue("finance-webhook-jobs", 8),
    WORK_NOTIFICATION_QUEUE: queue("tasks-work-notifications", 5), COMMUNICATION_QUEUE: queue("ledgerly-communications", 5),
    ENVIRONMENT: config.ENVIRONMENT, JWT_SECRET: config.JWT_SECRET, JWT_ISSUER: config.JWT_ISSUER, JWT_AUDIENCE: config.JWT_AUDIENCE,
    WHATSAPP_SUPPORT_HUB_URL: config.WHATSAPP_SUPPORT_HUB_URL, WHATSAPP_SUPPORT_APP_KEY: config.WHATSAPP_SUPPORT_APP_KEY,
    WHATSAPP_SUPPORT_WEBHOOK_SECRET: config.WHATSAPP_SUPPORT_WEBHOOK_SECRET, EGOSMS_API_URL: config.EGOSMS_API_URL,
    EGOSMS_USERNAME: config.EGOSMS_USERNAME, EGOSMS_PASSWORD: config.EGOSMS_PASSWORD, EGOSMS_SENDER_ID: config.EGOSMS_SENDER_ID,
    RESEND_API_KEY: config.RESEND_API_KEY, RESEND_FROM_EMAIL: config.RESEND_FROM_EMAIL, BIOMETRIC_ENCRYPTION_KEY: config.BIOMETRIC_ENCRYPTION_KEY,
  };
  return { env, db };
}
