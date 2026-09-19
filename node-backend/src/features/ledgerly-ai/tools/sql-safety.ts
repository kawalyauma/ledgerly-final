import { AppError } from "../../../http/errors.js";

const ALLOWED_TABLES = new Set([
  "contacts","school_students","school_guardians","school_student_guardians",
  "school_staff_profiles","school_classes","school_streams","school_subjects",
  "school_academic_years","school_terms","school_student_attendance_sessions",
  "school_student_attendance_records","school_staff_attendance_records","school_lesson_plans",
  "school_academic_delivery_logs","school_schemes_of_work","school_scheme_items",
  "school_academic_observations","school_student_fee_charges","school_fee_receipts",
  "school_fee_categories","documents","payments","payment_allocations","accounts",
  "journal_entries","journal_lines","payroll_employees","payroll_runs","payroll_lines",
  "work_projects","work_tasks","work_task_assignees",
]);

const BLOCKED = /\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|call|do|execute|vacuum|analyze|refresh|reindex|cluster|comment|security|set|reset|listen|notify|unlisten|prepare|deallocate|lock)\b/i;
const DANGEROUS = /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|pg_execute_server_program|dblink|lo_import|lo_export|current_setting|set_config|pg_terminate_backend|pg_cancel_backend)\s*\(/i;
const COMMENTS = /(--|\/\*|\*\/)/;
const TABLE_REF = /\b(?:from|join)\s+("?)([a-zA-Z_][a-zA-Z0-9_]*)\1(?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?/gi;
const SQL_RESERVED = new Set([
  "where","join","left","right","full","inner","outer","cross","on","group","order",
  "limit","offset","union","except","intersect","having","window","fetch","for",
]);

export type SafeSqlPlan = {
  sql: string;
  params: unknown[];
  tables: string[];
  tenantAliases: string[];
};

export function prepareSafeTenantSql(
  rawSql: string,
  organizationId: string,
  callerParams: unknown[] = [],
  hardLimit = 200,
): SafeSqlPlan {
  let sql = rawSql.trim();
  if (sql.endsWith(";")) sql = sql.slice(0, -1).trim();
  if (!sql || sql.includes(";") || COMMENTS.test(sql)) {
    throw new AppError(422, "UNSAFE_SQL", "Safe database queries must contain exactly one statement and no SQL comments.");
  }
  if (!/^(select|with)\b/i.test(sql) || BLOCKED.test(sql) || DANGEROUS.test(sql)) {
    throw new AppError(422, "UNSAFE_SQL", "Only read-only SELECT queries are permitted.");
  }

  const tables: string[] = [];
  const tenantAliases: string[] = [];
  TABLE_REF.lastIndex = 0;
  for (let match = TABLE_REF.exec(sql); match; match = TABLE_REF.exec(sql)) {
    const table = String(match[2] ?? "").toLowerCase();
    const candidateAlias = String(match[3] ?? "");
    if (!ALLOWED_TABLES.has(table)) {
      throw new AppError(422, "UNSAFE_SQL_TABLE", "Requested table is not available to Ledgerly AI safe queries.");
    }
    tables.push(table);
    const alias = candidateAlias && !SQL_RESERVED.has(candidateAlias.toLowerCase()) ? candidateAlias : table;
    tenantAliases.push(alias);
  }
  if (!tables.length) {
    throw new AppError(422, "UNSAFE_SQL_TABLE", "The query must read from an approved Ledgerly table.");
  }

  for (const alias of new Set(tenantAliases)) {
    const predicate = new RegExp("\\b" + alias + "\\.organization_id\\s*=\\s*\\$1\\b", "i");
    if (!predicate.test(sql)) {
      throw new AppError(
        422,
        "TENANT_PREDICATE_REQUIRED",
        "Safe database query must include " + alias + ".organization_id = $1 for every tenant table alias.",
      );
    }
  }

  const maxPlaceholder = [...sql.matchAll(/\$(\d+)/g)]
    .reduce((max, match) => Math.max(max, Number(match[1])), 0);
  if (maxPlaceholder > callerParams.length + 1) {
    throw new AppError(422, "SQL_PARAMETER_MISMATCH", "The safe database query references a missing parameter.");
  }

  return {
    sql: "SELECT * FROM (" + sql + ") AS ledgerly_ai_safe_query LIMIT " + Math.min(Math.max(hardLimit, 1), 500),
    params: [organizationId, ...callerParams],
    tables: [...new Set(tables)],
    tenantAliases: [...new Set(tenantAliases)],
  };
}
