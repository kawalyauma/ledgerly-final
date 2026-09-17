// Minimal D1-shaped wrapper over an existing pg.Pool, adapted from
// ../../../../selfhost/postgres-d1.ts, so the agentic-employees backend
// (originally written against Cloudflare D1's prepare().bind().first/all/run)
// can run unmodified against node-backend's Postgres pool.
import type { Pool, PoolClient } from "pg";

function placeholders(sql: string) {
  let n = 0, out = "", quote = "";
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (quote) { out += c; if (c === quote && sql[i - 1] !== "\\") quote = ""; continue; }
    if (c === "'" || c === '"') { quote = c; out += c; continue; }
    if (c === "?") { n++; out += `$${n}`; } else out += c;
  }
  return out;
}

function sqliteFunctions(sql: string) {
  return sql
    .replace(/datetime\('now'\s*,\s*'([+-])(\d+)\s+(minute|minutes|hour|hours|day|days)'\)/gi, (_, sign, n, unit) => `(CURRENT_TIMESTAMP ${sign} INTERVAL '${n} ${unit}')`)
    .replace(/date\('now'\s*,\s*'([+-])(\d+)\s+(day|days|month|months|year|years)'\)/gi, (_, sign, n, unit) => `(CURRENT_DATE ${sign} INTERVAL '${n} ${unit}')::date`)
    .replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP")
    .replace(/date\('now'\)/gi, "CURRENT_DATE")
    .replace(/(\$\d+)\s+IS\s+NULL/gi, "$1::text IS NULL")
    .replace(/GROUP_CONCAT\(\s*([^,()]+)\s*,\s*('(?:[^']|'')*')\s*\)/gi, "STRING_AGG($1, $2)")
    .replace(/IFNULL\(/gi, "COALESCE(")
    .replace(/\s+COLLATE\s+NOCASE/gi, "");
}

function normalizeInsertIgnore(sql: string) {
  if (!/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql)) return sql;
  let next = sql.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, "INSERT INTO");
  if (/\bON\s+CONFLICT\b/i.test(next)) return next;
  const returning = next.match(/\s+RETURNING\s+[\s\S]+$/i);
  if (returning) next = next.slice(0, returning.index) + " ON CONFLICT DO NOTHING" + returning[0];
  else next = next.replace(/;?\s*$/, " ON CONFLICT DO NOTHING");
  return next;
}

function quoteCamelAliases(sql: string) {
  const camel = /^[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*$/;
  let next = sql.replace(/\bAS\s+([a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*)\b/g, (_m, alias) => `AS "${alias}"`);
  next = next.replace(/(\b[A-Za-z_][A-Za-z0-9_$.]*\b|\))\s+([a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*)\b(?=\s*(?:,|\bFROM\b|\bWHERE\b|\bGROUP\b|\bHAVING\b|\bORDER\b|\bLIMIT\b|\bOFFSET\b|\bRETURNING\b|$))/g, (match, expr, alias) => camel.test(alias) ? `${expr} "${alias}"` : match);
  return next;
}

function translate(sql: string) {
  return normalizeInsertIgnore(sqliteFunctions(quoteCamelAliases(placeholders(sql))));
}

type BoundStatement = { sql: string; values: unknown[] };

class PgD1Statement {
  constructor(private runner: { query: (sql: string, values: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> }, public sql: string, public values: unknown[] = []) {}
  bind(...values: unknown[]) { return new PgD1Statement(this.runner, this.sql, values); }
  bound(): BoundStatement { return { sql: translate(this.sql), values: this.values }; }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const q = this.bound(), r = await this.runner.query(q.sql, q.values);
    const row = r.rows[0] ?? null;
    if (row == null) return null;
    return (column ? row[column] : row) as T;
  }
  async all<T = Record<string, unknown>>() {
    const q = this.bound(), r = await this.runner.query(q.sql, q.values);
    return { success: true, results: r.rows as T[], meta: { changes: r.rowCount ?? 0 } };
  }
  async run() {
    const q = this.bound(), r = await this.runner.query(q.sql, q.values);
    return { success: true, meta: { changes: r.rowCount ?? 0, duration: 0, last_row_id: null } };
  }
}

export class D1CompatDatabase {
  constructor(private pool: Pool) {}
  prepare(sql: string) { return new PgD1Statement(this.pool, sql); }
  async batch(statements: PgD1Statement[]) {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const out = [];
      for (const statement of statements) {
        const bound = statement.bound();
        const r = await client.query(bound.sql, bound.values);
        out.push({ success: true, results: r.rows, meta: { changes: r.rowCount ?? 0 } });
      }
      await client.query("COMMIT");
      return out;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async exec(sql: string) { await this.pool.query(sql); return { count: 0, duration: 0 }; }
}

export function createD1Compat(pool: Pool): any {
  return new D1CompatDatabase(pool);
}
