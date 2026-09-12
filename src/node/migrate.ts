import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const ssl = ["1", "true", "yes", "on"].includes((process.env.PG_SSL ?? "").toLowerCase()) ? { rejectUnauthorized: false } : undefined;
const pool = new Pool({ connectionString: databaseUrl, ssl });
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = path.join(repoRoot, "migrations-postgres");
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS selfhost_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const already = await pool.query("SELECT 1 FROM selfhost_schema_migrations WHERE name=$1", [name]); if (already.rowCount) continue;
    const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query(await readFile(path.join(migrationsDir, name), "utf8")); await client.query("INSERT INTO selfhost_schema_migrations (name) VALUES ($1)", [name]); await client.query("COMMIT"); console.log(`Applied ${name}`); }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
} finally { await pool.end(); }
