import type { Pool } from "pg";

export async function accountingReportDefaults(db: Pick<Pool, "query">, organizationId: string): Promise<{ from?: string }> {
  const result = await db.query<{ startDate: string }>(
    `SELECT metadata->>'accountingStartDate' AS "startDate" FROM journal_entries
     WHERE organization_id=$1 AND source_type='accounting_cutover' AND status='posted'
     ORDER BY posting_date DESC,created_at DESC LIMIT 1`, [organizationId]);
  const from = result.rows[0]?.startDate;
  return from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? { from } : {};
}

/** Current books start at the cutover; an entirely historical range remains available. */
export function accountingFilters<T extends { from?: string; to?: string; asOf?: string }>(filters: T, start?: string): T {
  if (!start || (filters.asOf ?? filters.to ?? "9999-12-31") < start) return filters;
  return { ...filters, from: filters.from && filters.from > start ? filters.from : start,
    ...(!filters.to && !filters.asOf ? { to: new Date().toISOString().slice(0, 10) } : {}) };
}

/** Cash accounts include explicitly typed bank accounts and bank-linked asset accounts. */
export const cashAccountSql = (alias: string) => `(${alias}.type='asset' AND (${alias}.subtype IN ('cash','bank') OR EXISTS (SELECT 1 FROM bank_accounts cash_bank WHERE cash_bank.organization_id=${alias}.organization_id AND cash_bank.ledger_account_id=${alias}.id)))`;
