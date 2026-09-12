import { Pool, types as pgTypes, type PoolClient, type QueryResult } from "pg";

// D1 exposes SQLite integers/numeric aggregates as JavaScript numbers and dates as strings.
// Keep those shapes at the compatibility boundary so existing routes do not change contracts.
pgTypes.setTypeParser(20, (value) => Number(value)); // int8 / COUNT / SUM(integer)
pgTypes.setTypeParser(1700, (value) => Number(value)); // numeric
pgTypes.setTypeParser(1082, (value) => value); // date
pgTypes.setTypeParser(1114, (value) => value); // timestamp
pgTypes.setTypeParser(1184, (value) => value); // timestamptz

export type PgExecutor = Pool | PoolClient;

function postgresError(error: unknown): Error {
  if (!error || typeof error !== "object") return error instanceof Error ? error : new Error(String(error));
  const pg = error as { code?: string; detail?: string; constraint?: string; column?: string; message?: string };
  if (pg.code === "23505") return new Error(`UNIQUE constraint failed: ${pg.detail ?? pg.constraint ?? pg.message ?? "duplicate value"}`);
  if (pg.code === "23503") return new Error(`FOREIGN KEY constraint failed: ${pg.detail ?? pg.constraint ?? pg.message ?? "related record"}`);
  if (pg.code === "23502") return new Error(`NOT NULL constraint failed: ${pg.column ?? pg.detail ?? pg.message ?? "required value"}`);
  if (pg.code === "23514") return new Error(`CHECK constraint failed: ${pg.constraint ?? pg.detail ?? pg.message ?? "invalid value"}`);
  return error instanceof Error ? error : new Error(pg.message ?? String(error));
}

function addOnConflictDoNothing(sql: string): string {
  if (/\bON\s+CONFLICT\b/i.test(sql)) return sql;
  const returning = sql.match(/\s+RETURNING\s+/i);
  if (returning?.index !== undefined) return `${sql.slice(0, returning.index)} ON CONFLICT DO NOTHING${sql.slice(returning.index)}`;
  const trimmed = sql.trimEnd();
  const semicolon = trimmed.endsWith(";") ? ";" : "";
  const body = semicolon ? trimmed.slice(0, -1) : trimmed;
  return `${body} ON CONFLICT DO NOTHING${semicolon}`;
}

export function translateD1Sql(input: string): string {
  let sql = input;
  let insertIgnore = false;
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(sql)) {
    insertIgnore = true;
    sql = sql.replace(/^(\s*)INSERT\s+OR\s+IGNORE\s+INTO\b/i, "$1INSERT INTO");
  }
  let output = "";
  let parameter = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]!;
    const next = sql[i + 1];
    if (char === "'" && !doubleQuoted) {
      output += char;
      if (singleQuoted && next === "'") { output += next; i += 1; continue; }
      singleQuoted = !singleQuoted;
      continue;
    }
    if (char === "\"" && !singleQuoted) {
      output += char;
      if (doubleQuoted && next === "\"") { output += next; i += 1; continue; }
      doubleQuoted = !doubleQuoted;
      continue;
    }
    if (char === "?" && !singleQuoted && !doubleQuoted) { parameter += 1; output += `$${parameter}`; continue; }
    output += char;
  }
  output = output
    .replace(/\bIFNULL\s*\(/gi, "COALESCE(")
    .replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, "CURRENT_TIMESTAMP")
    .replace(/\bdate\s*\(\s*'now'\s*\)/gi, "CURRENT_DATE")
    .replace(/\bdatetime\s*\(\s*'now'\s*,\s*([^\)]+)\)/gi, "ledgerly_datetime(CURRENT_TIMESTAMP, $1)")
    .replace(/\bdatetime\s*\(\s*CURRENT_TIMESTAMP\s*,\s*([^\)]+)\)/gi, "ledgerly_datetime(CURRENT_TIMESTAMP, $1)");
  if (insertIgnore) output = addOnConflictDoNothing(output);
  return output;
}

function meta(result: QueryResult): Record<string, unknown> {
  return { changed_db: result.rowCount !== null && result.rowCount > 0, changes: result.rowCount ?? 0, duration: 0, last_row_id: 0, rows_read: result.rows.length, rows_written: result.rowCount ?? 0, size_after: 0 };
}

export class PostgresD1Statement {
  private readonly database: PostgresD1Database;
  readonly sql: string;
  readonly params: unknown[];
  constructor(database: PostgresD1Database, sql: string, params: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }
  bind(...params: unknown[]): PostgresD1Statement { return new PostgresD1Statement(this.database, this.sql, params); }
  private async execute(executor: PgExecutor = this.database.pool): Promise<QueryResult> {
    try { return await executor.query(translateD1Sql(this.sql), this.params); } catch (error) { throw postgresError(error); }
  }
  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const result = await this.execute();
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.execute();
    return { success: true, results: result.rows as T[], meta: meta(result) } as D1Result<T>;
  }
  async run<T = unknown>(): Promise<D1Result<T>> {
    const result = await this.execute();
    return { success: true, results: result.rows as T[], meta: meta(result) } as D1Result<T>;
  }
  async raw<T = unknown>(options?: { columnNames?: boolean }): Promise<T[][]> {
    const result = await this.execute();
    const columns = result.fields.map((field) => field.name);
    const rows = result.rows.map((row: Record<string, unknown>) => columns.map((column) => row[column]) as T[]);
    return options?.columnNames ? [columns as unknown as T[], ...rows] : rows;
  }
  async executeWith(executor: PgExecutor): Promise<QueryResult> { return this.execute(executor); }
}

export class PostgresD1Database {
  readonly pool: Pool;
  constructor(connectionString: string, options?: { max?: number; ssl?: boolean }) {
    this.pool = new Pool({ connectionString, max: options?.max ?? 20, ssl: options?.ssl ? { rejectUnauthorized: false } : undefined });
  }
  prepare(sql: string): PostgresD1Statement { return new PostgresD1Statement(this, sql); }
  async batch<T = unknown>(statements: PostgresD1Statement[]): Promise<D1Result<T>[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const results: D1Result<T>[] = [];
      for (const statement of statements) {
        const result = await statement.executeWith(client);
        results.push({ success: true, results: result.rows as T[], meta: meta(result) } as D1Result<T>);
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw postgresError(error);
    } finally { client.release(); }
  }
  async exec(sql: string): Promise<D1ExecResult> {
    try { const result = await this.pool.query(sql); return { count: result.rowCount ?? 0, duration: 0 } as D1ExecResult; }
    catch (error) { throw postgresError(error); }
  }
  async close(): Promise<void> { await this.pool.end(); }
}
