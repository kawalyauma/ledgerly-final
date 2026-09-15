import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseEnv } from "../config/env.js";
import { createLogger } from "../lib/logger.js";
import { createPostgresPool } from "./pool.js";

const config = parseEnv();
const logger = createLogger(config.LOG_LEVEL);
const pool = createPostgresPool(config, logger);
const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS backend_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const sql = await readFile(path.join(migrationsDir, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const applied = await pool.query<{ checksum: string }>("SELECT checksum FROM backend_migrations WHERE name=$1", [name]);
    if (applied.rowCount) {
      const appliedChecksum = applied.rows[0]?.checksum;
      if (appliedChecksum !== checksum) {
        throw new Error(`Migration ${name} changed after it was applied (database=${appliedChecksum ?? "missing"}, file=${checksum}). Restore the exact applied migration; do not overwrite the recorded checksum.`);
      }
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO backend_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
      await client.query("COMMIT");
      logger.info({ migration: name }, "Applied migration");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
