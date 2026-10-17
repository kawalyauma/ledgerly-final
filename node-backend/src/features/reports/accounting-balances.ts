import type { Pool } from "pg";
import type { ReportFilters, ReportResult } from "./service.js";

/** Read the posted control accounts, including carried learner balances and existing write-offs. */
export async function accountingCounterpartyBalances(db: Pool, organizationId: string, start: string, filters: ReportFilters) {
  const asOf = filters.asOf ?? filters.to ?? new Date().toISOString().slice(0,10);
  const result = await db.query<{
    contactId: string; code: string; contact: string; type: string; openingDate: string;
    receivableMinor: number; payableMinor: number;
  }>(
    `SELECT COALESCE(s.id,c.id,a.id) AS "contactId",COALESCE(s.admission_number,c.code,a.code) AS code,
      COALESCE(NULLIF(concat_ws(' ',s.first_name,s.middle_name,s.last_name),''),c.name,a.name) AS contact,
      CASE WHEN a.type='asset' THEN 'customer' ELSE 'supplier' END AS type,
      GREATEST(MIN(j.posting_date) FILTER (WHERE l.base_debit_minor>0 OR l.base_credit_minor>0),$3::date)::text AS "openingDate",
      COALESCE(SUM(CASE WHEN a.type='asset' THEN l.base_debit_minor-l.base_credit_minor ELSE 0 END),0)::float8 AS "receivableMinor",
      COALESCE(SUM(CASE WHEN a.type='liability' THEN l.base_credit_minor-l.base_debit_minor ELSE 0 END),0)::float8 AS "payableMinor"
     FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
     JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
     LEFT JOIN contacts c ON c.id=l.contact_id AND c.organization_id=l.organization_id
     LEFT JOIN school_students s ON s.id=l.dimensions_json->>'schoolStudentId' AND s.organization_id=l.organization_id
     WHERE l.organization_id=$1 AND j.status IN ('posted','reversed') AND j.posting_date <= $2::date
       AND ((a.type='asset' AND a.subtype IN ('receivable','school_fee_receivable'))
         OR (a.type='liability' AND a.subtype='payable' AND j.posting_date >= $3::date))
       AND ($4::text IS NULL OR l.contact_id=$4 OR s.id=$4)
       AND ($5::text IS NULL OR l.account_id=$5) AND ($6::text IS NULL OR l.project_id=$6)
     GROUP BY COALESCE(s.id,c.id,a.id),COALESCE(s.admission_number,c.code,a.code),
       COALESCE(NULLIF(concat_ws(' ',s.first_name,s.middle_name,s.last_name),''),c.name,a.name),a.type
     HAVING SUM(l.base_debit_minor-l.base_credit_minor)<>0 ORDER BY contact`,
    [organizationId,asOf,start,filters.contactId ?? null,filters.accountId ?? null,filters.projectId ?? null]);
  return result.rows;
}

export async function accountingAging(db: Pool, organizationId: string, start: string, customer: boolean, filters: ReportFilters): Promise<ReportResult> {
  const asOf = filters.asOf ?? filters.to ?? new Date().toISOString().slice(0,10);
  const balances = await accountingCounterpartyBalances(db,organizationId,start,filters);
  const buckets = { currentMinor: 0, days1to30Minor: 0, days31to60Minor: 0, days61to90Minor: 0, days90PlusMinor: 0 };
  const rows = balances.filter(r => r.type === (customer ? "customer" : "supplier")).map(r => {
    const outstandingMinor = customer ? r.receivableMinor : r.payableMinor;
    const daysOutstanding = outstandingMinor < 0 ? 0 : Math.max(0, Math.floor((Date.parse(asOf)-Date.parse(r.openingDate))/86400000));
    const bucket = daysOutstanding===0 ? "current" : daysOutstanding<=30 ? "1-30" : daysOutstanding<=60 ? "31-60" : daysOutstanding<=90 ? "61-90" : "90+";
    const key = daysOutstanding===0 ? "currentMinor" : daysOutstanding<=30 ? "days1to30Minor" : daysOutstanding<=60 ? "days31to60Minor" : daysOutstanding<=90 ? "days61to90Minor" : "days90PlusMinor";
    buckets[key] += outstandingMinor;
    return { ...r, outstandingMinor, daysOutstanding, bucket };
  });
  return { reportType: customer ? "receivables-ageing" : "payables-ageing", generatedAt: new Date().toISOString(), filters,
    columns: ["code","contact","openingDate","outstandingMinor","daysOutstanding","bucket"],rows,
    totals: { outstandingMinor: rows.reduce((n,r)=>n+r.outstandingMinor,0),...buckets } };
}
