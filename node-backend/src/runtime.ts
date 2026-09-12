import { createClient, type RedisClientType } from "redis";
import type { Pool } from "pg";
import { parseEnv, type AppConfig } from "./config/env.js";
import { createPostgresPool } from "./db/pool.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { PostgresQueue } from "./queue/postgres-queue.js";
import { createStorage } from "./storage/index.js";
import type { ObjectStorage } from "./storage/types.js";

export type Runtime = {
  config: AppConfig;
  logger: Logger;
  db: Pool;
  cache: RedisClientType;
  storage: ObjectStorage;
  queue: PostgresQueue;
  close(): Promise<void>;
};

export async function createRuntime(config: AppConfig = parseEnv()): Promise<Runtime> {
  const logger = createLogger(config.LOG_LEVEL);
  const db = createPostgresPool(config, logger);
  const cache = createClient({ url: config.REDIS_URL });
  cache.on("error", (error) => logger.error({ err: error }, "Redis error"));
  const storage = createStorage(config);
  const queue = new PostgresQueue(db);

  await Promise.all([db.query("SELECT 1"), cache.connect(), storage.initialize()]);

  return {
    config, logger, db, cache, storage, queue,
    async close() {
      await Promise.allSettled([cache.quit(), db.end()]);
    },
  };
}
