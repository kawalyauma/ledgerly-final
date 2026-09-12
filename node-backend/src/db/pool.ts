import { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import type { Logger } from "../lib/logger.js";

export function createPostgresPool(config: AppConfig, logger: Logger): Pool {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    application_name: "ledgerly-node-backend",
  });
  pool.on("error", (error) => logger.error({ err: error }, "Unexpected PostgreSQL pool error"));
  return pool;
}
