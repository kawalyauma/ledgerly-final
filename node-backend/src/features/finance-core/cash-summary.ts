import type { Pool } from "pg";
import { cashAccountSql } from "./reporting-period.js";

export const CASH_DESCRIPTION = "Actual money received and paid out. Unpaid invoices, bursaries, concessions and transfers between your own cash or bank accounts are excluded.";
type CashDay = { date: string; receivedMinor: number; paidOutMinor: number; feesCollectedMinor: number; feeRefundsMinor: number; otherReceiptsMinor: number };

/** Net cash across all cash/bank lines of each journal first, so transfers never inflate collections. */
export async function cashSummary(db: Pick<Pool,"query">, org: string, from: string, to: string) {
  const { rows } = await db.query<CashDay>(
    `WITH cash_entries AS (
       SELECT j.id,j.posting_date,COALESCE(original.source_type,j.source_type) AS source_type,SUM(l.base_debit_minor-l.base_credit_minor) AS movement
       FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id AND l.organization_id=j.organization_id
       JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
       LEFT JOIN journal_entries original ON original.id=j.reversal_of_id AND original.organization_id=j.organization_id
       WHERE j.organization_id=$1 AND j.status IN ('posted','reversed') AND j.posting_date BETWEEN $2::date AND $3::date
         AND ${cashAccountSql("a")} AND COALESCE(original.source_type,j.source_type) NOT IN ('accounting_cutover','opening_balance')
       GROUP BY j.id,j.posting_date,COALESCE(original.source_type,j.source_type)
     ) SELECT posting_date::text AS date,
       SUM(GREATEST(movement,0))::float8 AS "receivedMinor",SUM(GREATEST(-movement,0))::float8 AS "paidOutMinor",
       COALESCE(SUM(GREATEST(movement,0)) FILTER (WHERE source_type IN ('receipt','schoolpay_payment')),0)::float8 AS "feesCollectedMinor",
       COALESCE(SUM(GREATEST(-movement,0)) FILTER (WHERE source_type IN ('receipt','schoolpay_payment','payment_reversal','school_fee_refund')),0)::float8 AS "feeRefundsMinor",
       COALESCE(SUM(GREATEST(movement,0)) FILTER (WHERE source_type NOT IN ('receipt','schoolpay_payment')),0)::float8 AS "otherReceiptsMinor"
     FROM cash_entries WHERE movement<>0 GROUP BY posting_date ORDER BY posting_date`,[org,from,to]);
  const totals = { receivedMinor:0,paidOutMinor:0,feesCollectedMinor:0,feeRefundsMinor:0,otherReceiptsMinor:0,netCashMovementMinor:0 };
  const daily = rows.map(r=>({...r,netCashMovementMinor:Number(r.receivedMinor)-Number(r.paidOutMinor)}));
  for (const r of daily) for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key]+=Number(r[key]);
  return { ...totals, daily };
}
