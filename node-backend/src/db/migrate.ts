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

const LEGACY_0017_NAME = "0017_sales_purchasing_operations.sql";
const LEGACY_0017_CHECKSUM = "9f96046b6cb4ea3fb7ea63f989077ed8593228c9a422ddbc811ae5ad8e6c1d68";
const LEGACY_0017_REQUIRED_TABLES = [
  "orders",
  "order_lines",
  "delivery_notes",
  "delivery_note_lines",
  "purchase_requisitions",
  "goods_receipts",
  "goods_receipt_lines",
  "recurring_templates",
  "approval_policies",
  "document_approval_requests",
];

async function verifyLegacy0017Schema() {
  const missingTables: string[] = [];
  for (const table of LEGACY_0017_REQUIRED_TABLES) {
    const result = await pool.query<{ relation: string | null }>("SELECT to_regclass($1) AS relation", [table]);
    if (!result.rows[0]?.relation) missingTables.push(table);
  }
  const approvalColumn = await pool.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema=current_schema()
        AND table_name='documents'
        AND column_name='approval_status'
      LIMIT 1`,
  );
  return {
    compatible: missingTables.length === 0 && Boolean(approvalColumn.rowCount),
    missingTables,
    missingApprovalStatus: !approvalColumn.rowCount,
  };
}

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
        if (name === LEGACY_0017_NAME && appliedChecksum === LEGACY_0017_CHECKSUM) {
          const verification = await verifyLegacy0017Schema();
          if (!verification.compatible) {
            throw new Error(
              `Legacy migration ${name} has the known production checksum but its schema is incomplete ` +
              `(missingTables=${verification.missingTables.join(",") || "none"}, missingDocumentsApprovalStatus=${verification.missingApprovalStatus}). ` +
              `Refusing to continue until the schema is reconciled.`,
            );
          }
          logger.warn(
            { migration: name, databaseChecksum: appliedChecksum, repositoryChecksum: checksum },
            "Verified known legacy migration schema; preserving recorded checksum and continuing",
          );
          continue;
        }
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
