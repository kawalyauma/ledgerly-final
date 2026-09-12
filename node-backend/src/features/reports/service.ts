import type { Pool } from "pg";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";

export const reportCatalog = [
  { id: "profit-loss", name: "Profit & Loss", available: true },
  { id: "balance-sheet", name: "Balance Sheet", available: true },
  { id: "cash-flow", name: "Cash Flow", available: true },
  { id: "trial-balance", name: "Trial Balance", available: true },
  { id: "general-ledger", name: "General Ledger", available: true },
  { id: "transaction-detail", name: "Transaction Detail", available: true },
  { id: "receivables-ageing", name: "Accounts Receivable Aging", available: true },
  { id: "payables-ageing", name: "Accounts Payable Aging", available: true },
  { id: "sales-analysis", name: "Sales Analysis", available: true },
  { id: "expense-analysis", name: "Expense Analysis", available: true },
  { id: "project-profitability", name: "Project Profitability", available: true },
  { id: "tax-summary", name: "Tax Summary", available: true },
  { id: "payroll-summary", name: "Payroll Ledger Summary", available: true },
  { id: "changes-in-equity", name: "Changes in Equity", available: true },
  { id: "retained-earnings", name: "Retained Earnings", available: true },
  { id: "customer-statement", name: "Customer Statement", available: true },
  { id: "supplier-statement", name: "Supplier Statement", available: true },
  { id: "bank-reconciliation", name: "Bank Reconciliation", available: true },
  { id: "depreciation", name: "Depreciation Ledger", available: true },
  { id: "detailed-tax-return", name: "Detailed Tax Return", available: true },
  { id: "comparative-statements", name: "Comparative Statements", available: true },
  { id: "account-activity", name: "Account Activity", available: true },
  { id: "journal-summary", name: "Journal Summary", available: true },
  { id: "document-summary", name: "Document Summary", available: true },
  { id: "payments-summary", name: "Payments Summary", available: true },
  { id: "contact-balances", name: "Customer/Supplier Balances", available: true },
  { id: "cash-bank-summary", name: "Cash & Bank Summary", available: true },
  { id: "bank-transactions", name: "Bank Transactions", available: true },
  { id: "reconciliation-summary", name: "Reconciliation Summary", available: true },
  { id: "fiscal-period-summary", name: "Fiscal Period Summary", available: true },
  { id: "financial-ratios", name: "Financial Ratios", available: true },
  { id: "draft-transactions", name: "Draft Transactions", available: true },
  { id: "audit-trail", name: "Finance Audit Trail", available: true },
  { id: "inventory-valuation", name: "Inventory Valuation", available: false, dependency: "inventory" },
  { id: "budget-vs-actual", name: "Budget vs Actual", available: false, dependency: "budgets" },
  { id: "fixed-asset-register", name: "Fixed Asset Register", available: false, dependency: "fixed-assets" },
  { id: "consolidated-statements", name: "Consolidated Statements", available: false, dependency: "multi-entity consolidation" },
] as const;

export type ReportType = typeof reportCatalog[number]["id"];
export const reportTypes = reportCatalog.map((report) => report.id) as ReportType[];
export type ReportFilters = {
  from?: string;
  to?: string;
  asOf?: string;
  accountId?: string;
  contactId?: string;
  projectId?: string;
};
export type ReportResult = {
  reportType: ReportType;
  generatedAt: string;
  filters: ReportFilters;
  columns: string[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
};

type LedgerRow = {
  accountId: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  subtype: string | null;
  debitMinor: number;
  creditMinor: number;
  netDebitMinor: number;
};

const MIN_DATE = "0001-01-01";
const MAX_DATE = "9999-12-31";

function availableDefinition(type: string) {
  const definition = reportCatalog.find((report) => report.id === type);
  if (!definition) throw new AppError(404, "UNKNOWN_REPORT", "Unknown report type");
  if (!definition.available) throw new AppError(409, "REPORT_DEPENDENCY_NOT_MIGRATED", `${definition.name} requires the ${definition.dependency} feature to be migrated first`);
  return definition;
}

function range(filters: ReportFilters) {
  return { from: filters.from ?? MIN_DATE, to: filters.to ?? filters.asOf ?? MAX_DATE };
}

function dimensions(filters: ReportFilters, alias: string, startIndex: number) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of [["accountId", "account_id"], ["contactId", "contact_id"], ["projectId", "project_id"]] as const) {
    const value = filters[key];
    if (value) {
      values.push(value);
      clauses.push(`${alias}.${column}=$${startIndex + values.length - 1}`);
    }
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
}

async function ledgerSummary(db: Pool, organizationId: string, filters: ReportFilters, accountTypes?: string[]): Promise<LedgerRow[]> {
  const { from, to } = range(filters);
  const params: unknown[] = [organizationId, from, to];
  let typeSql = "";
  if (accountTypes?.length) {
    params.push(accountTypes);
    typeSql = ` AND a.type=ANY($${params.length}::text[])`;
  }
  const dim = dimensions(filters, "l", params.length + 1);
  params.push(...dim.values);
  const result = await db.query<LedgerRow>(
    `SELECT a.id AS "accountId",a.code,a.name,a.type,a.subtype,
      COALESCE(SUM(l.base_debit_minor),0)::float8 AS "debitMinor",
      COALESCE(SUM(l.base_credit_minor),0)::float8 AS "creditMinor",
      COALESCE(SUM(l.base_debit_minor-l.base_credit_minor),0)::float8 AS "netDebitMinor"
     FROM journal_lines l
     JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
     JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
     WHERE l.organization_id=$1 AND j.status IN ('posted','reversed')
       AND j.posting_date BETWEEN $2::date AND $3::date${typeSql}${dim.sql}
     GROUP BY a.id,a.code,a.name,a.type,a.subtype ORDER BY a.code`, params);
  return result.rows;
}

function normalAmount(row: LedgerRow) {
  return row.type === "asset" || row.type === "expense" ? row.debitMinor - row.creditMinor : row.creditMinor - row.debitMinor;
}

function ageBucket(days: number) {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

async function aging(db: Pool, organizationId: string, type: "invoice" | "bill", filters: ReportFilters): Promise<ReportResult> {
  const asOf = filters.asOf ?? filters.to ?? new Date().toISOString().slice(0, 10);
  const params: unknown[] = [organizationId, type, asOf];
  let contactSql = "";
  if (filters.contactId) { params.push(filters.contactId); contactSql = ` AND d.contact_id=$${params.length}`; }
  const result = await db.query<{
    id: string; number: string; contactId: string; contact: string; issueDate: string; dueDate: string | null;
    totalMinor: number; paidMinor: number; outstandingMinor: number; daysOverdue: number;
  }>(
    `WITH paid AS (
       SELECT pa.document_id,
         COALESCE(SUM(pa.amount_minor) FILTER (
           WHERE p.payment_date <= $3::date
             AND (pa.reversed_at IS NULL OR r.posting_date IS NULL OR r.posting_date > $3::date)
         ),0) AS paid_minor
       FROM payment_allocations pa
       JOIN payments p ON p.id=pa.payment_id AND p.organization_id=pa.organization_id
       LEFT JOIN journal_entries r ON r.id=p.reversal_journal_id AND r.organization_id=p.organization_id
       WHERE pa.organization_id=$1 GROUP BY pa.document_id
     )
     SELECT d.id,d.number,d.contact_id AS "contactId",c.name AS contact,d.issue_date::text AS "issueDate",d.due_date::text AS "dueDate",
       d.total_minor::float8 AS "totalMinor",COALESCE(paid.paid_minor,0)::float8 AS "paidMinor",
       (d.total_minor-COALESCE(paid.paid_minor,0))::float8 AS "outstandingMinor",
       ($3::date-COALESCE(d.due_date,d.issue_date))::int AS "daysOverdue"
     FROM documents d
     JOIN contacts c ON c.id=d.contact_id AND c.organization_id=d.organization_id
     LEFT JOIN paid ON paid.document_id=d.id
     LEFT JOIN journal_entries reversal ON reversal.organization_id=d.organization_id AND reversal.reversal_of_id=d.journal_entry_id
     WHERE d.organization_id=$1 AND d.type=$2 AND d.issue_date <= $3::date
       AND (d.status <> 'void' OR reversal.posting_date > $3::date)
       AND d.total_minor-COALESCE(paid.paid_minor,0) > 0${contactSql}
     ORDER BY COALESCE(d.due_date,d.issue_date),d.number`, params);
  const rows = result.rows.map((row) => ({ ...row, bucket: ageBucket(row.daysOverdue) }));
  const buckets = { currentMinor: 0, days1to30Minor: 0, days31to60Minor: 0, days61to90Minor: 0, days90PlusMinor: 0 };
  for (const row of rows) {
    if (row.bucket === "current") buckets.currentMinor += row.outstandingMinor;
    else if (row.bucket === "1-30") buckets.days1to30Minor += row.outstandingMinor;
    else if (row.bucket === "31-60") buckets.days31to60Minor += row.outstandingMinor;
    else if (row.bucket === "61-90") buckets.days61to90Minor += row.outstandingMinor;
    else buckets.days90PlusMinor += row.outstandingMinor;
  }
  return {
    reportType: type === "invoice" ? "receivables-ageing" : "payables-ageing",
    generatedAt: new Date().toISOString(), filters,
    columns: ["number","contact","issueDate","dueDate","totalMinor","paidMinor","outstandingMinor","daysOverdue","bucket"],
    rows, totals: { outstandingMinor: rows.reduce((sum, row) => sum + row.outstandingMinor, 0), ...buckets },
  };
}

async function statement(db: Pool, organizationId: string, customer: boolean, filters: ReportFilters): Promise<ReportResult> {
  const { from, to } = range(filters);
  const docType = customer ? "invoice" : "bill";
  const paymentType = customer ? "receipt" : "payment";
  const params: unknown[] = [organizationId, docType, paymentType, from, to];
  let contactSqlDoc = "", contactSqlPay = "";
  if (filters.contactId) {
    params.push(filters.contactId);
    contactSqlDoc = ` AND d.contact_id=$${params.length}`;
    contactSqlPay = ` AND p.contact_id=$${params.length}`;
  }
  const result = await db.query<{
    date: string; reference: string; source: string; contactId: string; contact: string; debitMinor: number; creditMinor: number;
  }>(
    `SELECT d.issue_date::text AS date,d.number AS reference,'document'::text AS source,d.contact_id AS "contactId",c.name AS contact,
       ${customer ? "d.total_minor" : "0"}::float8 AS "debitMinor",${customer ? "0" : "d.total_minor"}::float8 AS "creditMinor"
     FROM documents d JOIN contacts c ON c.id=d.contact_id AND c.organization_id=d.organization_id
     WHERE d.organization_id=$1 AND d.type=$2 AND d.status<>'void' AND d.issue_date BETWEEN $4::date AND $5::date${contactSqlDoc}
     UNION ALL
     SELECT p.payment_date::text,p.number,'payment',p.contact_id,c.name,
       ${customer ? "0" : "p.amount_minor"}::float8,${customer ? "p.amount_minor" : "0"}::float8
     FROM payments p JOIN contacts c ON c.id=p.contact_id AND c.organization_id=p.organization_id
     WHERE p.organization_id=$1 AND p.type=$3 AND p.status='posted' AND p.payment_date BETWEEN $4::date AND $5::date${contactSqlPay}
     ORDER BY date,reference`, params);
  let running = 0;
  const rows = result.rows.map((row) => {
    running += row.debitMinor - row.creditMinor;
    return { ...row, balanceMinor: running };
  });
  return {
    reportType: customer ? "customer-statement" : "supplier-statement",
    generatedAt: new Date().toISOString(), filters,
    columns: ["date","reference","source","contact","debitMinor","creditMinor","balanceMinor"], rows,
    totals: { debitMinor: rows.reduce((n, r) => n + r.debitMinor, 0), creditMinor: rows.reduce((n, r) => n + r.creditMinor, 0), balanceMinor: running },
  };
}

export async function generateReport(runtime: Pick<Runtime,"db">, organizationId: string, reportType: string, filters: ReportFilters = {}): Promise<ReportResult> {
  availableDefinition(reportType);
  const type = reportType as ReportType;
  const db = runtime.db;
  const generatedAt = new Date().toISOString();
  let rows: Record<string, unknown>[] = [];
  let columns: string[] = [];
  let totals: Record<string, number> | undefined;

  if (type === "receivables-ageing") return aging(db, organizationId, "invoice", filters);
  if (type === "payables-ageing") return aging(db, organizationId, "bill", filters);
  if (type === "customer-statement") return statement(db, organizationId, true, filters);
  if (type === "supplier-statement") return statement(db, organizationId, false, filters);

  if (type === "profit-loss") {
    const ledger = await ledgerSummary(db, organizationId, filters, ["revenue","expense"]);
    rows = ledger.map((row) => ({ ...row, amountMinor: normalAmount(row) }));
    const revenueMinor = ledger.filter((row) => row.type === "revenue").reduce((sum, row) => sum + normalAmount(row), 0);
    const expenseMinor = ledger.filter((row) => row.type === "expense").reduce((sum, row) => sum + normalAmount(row), 0);
    totals = { revenueMinor, expenseMinor, netProfitMinor: revenueMinor - expenseMinor };
    columns = ["code","name","type","subtype","amountMinor"];
  } else if (type === "balance-sheet") {
    const asOf = filters.asOf ?? filters.to ?? MAX_DATE;
    const base = { ...filters, from: MIN_DATE, to: asOf };
    const ledger = await ledgerSummary(db, organizationId, base, ["asset","liability","equity"]);
    rows = ledger.map((row) => ({ ...row, amountMinor: normalAmount(row) }));
    const income = await ledgerSummary(db, organizationId, base, ["revenue","expense"]);
    const currentEarningsMinor = income.reduce((sum, row) => sum + (row.type === "revenue" ? normalAmount(row) : -normalAmount(row)), 0);
    if (currentEarningsMinor !== 0) rows.push({ accountId: "current-earnings", code: "CURRENT-EARNINGS", name: "Current earnings", type: "equity", subtype: "current_earnings", amountMinor: currentEarningsMinor });
    const assetMinor = rows.filter((row) => row.type === "asset").reduce((sum, row) => sum + Number(row.amountMinor), 0);
    const liabilityMinor = rows.filter((row) => row.type === "liability").reduce((sum, row) => sum + Number(row.amountMinor), 0);
    const equityMinor = rows.filter((row) => row.type === "equity").reduce((sum, row) => sum + Number(row.amountMinor), 0);
    totals = { assetMinor, liabilityMinor, equityMinor, differenceMinor: assetMinor - liabilityMinor - equityMinor };
    columns = ["code","name","type","subtype","amountMinor"];
  } else if (type === "trial-balance") {
    const ledger = await ledgerSummary(db, organizationId, filters);
    rows = ledger;
    totals = { debitMinor: ledger.reduce((sum, row) => sum + row.debitMinor, 0), creditMinor: ledger.reduce((sum, row) => sum + row.creditMinor, 0) };
    columns = ["code","name","type","debitMinor","creditMinor","netDebitMinor"];
  } else if (type === "general-ledger" || type === "transaction-detail" || type === "account-activity") {
    const { from, to } = range(filters);
    const params: unknown[] = [organizationId, from, to];
    const dim = dimensions(filters, "l", 4); params.push(...dim.values);
    const result = await db.query(
      `SELECT j.entry_number AS "entryNumber",j.posting_date::text AS "postingDate",j.description AS "journalDescription",j.reference,j.source_type AS "sourceType",
        a.code AS "accountCode",a.name AS "accountName",l.description,l.debit_minor::float8 AS "debitMinor",l.credit_minor::float8 AS "creditMinor",
        c.name AS contact,l.contact_id AS "contactId",l.project_id AS "projectId",l.tax_code AS "taxCode"
       FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
       JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
       LEFT JOIN contacts c ON c.id=l.contact_id AND c.organization_id=l.organization_id
       WHERE l.organization_id=$1 AND j.status IN ('posted','reversed') AND j.posting_date BETWEEN $2::date AND $3::date${dim.sql}
       ORDER BY j.posting_date,j.entry_number,l.id LIMIT 20000`, params);
    rows = result.rows;
    totals = { debitMinor: rows.reduce((n, r) => n + Number(r.debitMinor), 0), creditMinor: rows.reduce((n, r) => n + Number(r.creditMinor), 0) };
    columns = ["entryNumber","postingDate","accountCode","accountName","journalDescription","description","debitMinor","creditMinor","contact","projectId","sourceType"];
  } else if (type === "cash-flow") {
    const { from, to } = range(filters);
    const result = await db.query(
      `WITH cash_accounts AS (
         SELECT id FROM accounts WHERE organization_id=$1 AND (subtype='cash' OR id IN (SELECT ledger_account_id FROM bank_accounts WHERE organization_id=$1))
       ), cash_entries AS (
         SELECT DISTINCT l.journal_entry_id FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
         WHERE l.organization_id=$1 AND l.account_id IN (SELECT id FROM cash_accounts) AND j.status IN ('posted','reversed') AND j.posting_date BETWEEN $2::date AND $3::date
       )
       SELECT CASE
         WHEN a.type IN ('revenue','expense') OR a.subtype IN ('receivable','payable','tax','payroll') THEN 'operating'
         WHEN a.type='asset' THEN 'investing'
         WHEN a.type IN ('liability','equity') THEN 'financing'
         ELSE 'other' END AS activity,
         a.code,a.name,COALESCE(SUM(l.base_credit_minor-l.base_debit_minor),0)::float8 AS "amountMinor"
       FROM journal_lines l JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
       WHERE l.organization_id=$1 AND l.journal_entry_id IN (SELECT journal_entry_id FROM cash_entries)
         AND l.account_id NOT IN (SELECT id FROM cash_accounts)
       GROUP BY activity,a.code,a.name ORDER BY activity,a.code`, [organizationId, from, to]);
    rows = result.rows;
    const operatingMinor = rows.filter((r) => r.activity === "operating").reduce((n, r) => n + Number(r.amountMinor), 0);
    const investingMinor = rows.filter((r) => r.activity === "investing").reduce((n, r) => n + Number(r.amountMinor), 0);
    const financingMinor = rows.filter((r) => r.activity === "financing").reduce((n, r) => n + Number(r.amountMinor), 0);
    totals = { operatingMinor, investingMinor, financingMinor, netCashChangeMinor: operatingMinor + investingMinor + financingMinor };
    columns = ["activity","code","name","amountMinor"];
  } else if (type === "sales-analysis" || type === "expense-analysis") {
    const { from, to } = range(filters);
    const docType = type === "sales-analysis" ? "invoice" : "bill";
    const params: unknown[] = [organizationId, docType, from, to];
    let contactSql = "";
    if (filters.contactId) { params.push(filters.contactId); contactSql = ` AND d.contact_id=$${params.length}`; }
    const result = await db.query(
      `SELECT c.id AS "contactId",c.name AS contact,a.id AS "accountId",a.code AS "accountCode",a.name AS "accountName",
        COALESCE(SUM(dl.quantity_micros),0)::float8 AS "quantityMicros",COALESCE(SUM(dl.subtotal_minor),0)::float8 AS "subtotalMinor",
        COALESCE(SUM(dl.tax_minor),0)::float8 AS "taxMinor",COALESCE(SUM(dl.total_minor),0)::float8 AS "totalMinor"
       FROM document_lines dl JOIN documents d ON d.id=dl.document_id AND d.organization_id=dl.organization_id
       JOIN contacts c ON c.id=d.contact_id AND c.organization_id=d.organization_id
       JOIN accounts a ON a.id=dl.account_id AND a.organization_id=dl.organization_id
       WHERE dl.organization_id=$1 AND d.type=$2 AND d.status IN ('open','partially_paid','paid') AND d.issue_date BETWEEN $3::date AND $4::date${contactSql}
       GROUP BY c.id,c.name,a.id,a.code,a.name ORDER BY "totalMinor" DESC`, params);
    rows = result.rows;
    totals = { totalMinor: rows.reduce((n, r) => n + Number(r.totalMinor), 0), taxMinor: rows.reduce((n, r) => n + Number(r.taxMinor), 0) };
    columns = ["contact","accountCode","accountName","quantityMicros","subtotalMinor","taxMinor","totalMinor"];
  } else if (type === "project-profitability") {
    const { from, to } = range(filters);
    const params: unknown[] = [organizationId, from, to];
    let projectSql = "";
    if (filters.projectId) { params.push(filters.projectId); projectSql = ` AND l.project_id=$${params.length}`; }
    const result = await db.query(
      `SELECT l.project_id AS "projectId",
        COALESCE(SUM(CASE WHEN a.type='revenue' THEN l.base_credit_minor-l.base_debit_minor ELSE 0 END),0)::float8 AS "revenueMinor",
        COALESCE(SUM(CASE WHEN a.type='expense' THEN l.base_debit_minor-l.base_credit_minor ELSE 0 END),0)::float8 AS "expenseMinor"
       FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
       JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
       WHERE l.organization_id=$1 AND l.project_id IS NOT NULL AND j.status IN ('posted','reversed') AND j.posting_date BETWEEN $2::date AND $3::date${projectSql}
       GROUP BY l.project_id ORDER BY l.project_id`, params);
    rows = result.rows.map((row) => ({ ...row, profitMinor: Number(row.revenueMinor) - Number(row.expenseMinor) }));
    columns = ["projectId","revenueMinor","expenseMinor","profitMinor"];
  } else if (type === "tax-summary" || type === "payroll-summary" || type === "depreciation") {
    const ledger = await ledgerSummary(db, organizationId, filters);
    const marker = type === "tax-summary" ? "tax" : type === "payroll-summary" ? "payroll" : "depreci";
    rows = ledger.filter((row) => String(row.subtype ?? "").toLowerCase().includes(marker)).map((row) => ({ ...row, amountMinor: normalAmount(row) }));
    totals = { amountMinor: rows.reduce((n, r) => n + Number(r.amountMinor), 0) };
    columns = ["code","name","type","subtype","debitMinor","creditMinor","amountMinor"];
  } else if (type === "changes-in-equity" || type === "retained-earnings") {
    const ledger = await ledgerSummary(db, organizationId, filters, ["equity","revenue","expense"]);
    rows = ledger.map((row) => ({ ...row, amountMinor: row.type === "expense" ? -normalAmount(row) : normalAmount(row) }));
    totals = { changeMinor: rows.reduce((n, r) => n + Number(r.amountMinor), 0) };
    columns = ["code","name","type","amountMinor"];
  } else if (type === "bank-reconciliation" || type === "reconciliation-summary") {
    const asOf = filters.asOf ?? filters.to ?? MAX_DATE;
    const result = await db.query(
      `SELECT b.id AS "bankAccountId",b.name,b.bank_name AS "bankName",b.currency,r.id AS "reconciliationId",r.statement_date::text AS "statementDate",
        r.statement_balance_minor::float8 AS "statementBalanceMinor",r.ledger_balance_minor::float8 AS "ledgerBalanceMinor",
        r.difference_minor::float8 AS "differenceMinor",r.matched_count AS "matchedCount",r.unmatched_count AS "unmatchedCount",r.status,r.completed_at AS "completedAt"
       FROM bank_accounts b LEFT JOIN LATERAL (
         SELECT * FROM bank_reconciliations x WHERE x.organization_id=b.organization_id AND x.bank_account_id=b.id AND x.statement_date <= $2::date
         ORDER BY x.statement_date DESC,x.created_at DESC LIMIT 1
       ) r ON true WHERE b.organization_id=$1 ORDER BY b.name`, [organizationId, asOf]);
    rows = result.rows;
    columns = ["name","bankName","currency","statementDate","statementBalanceMinor","ledgerBalanceMinor","differenceMinor","matchedCount","unmatchedCount","status"];
  } else if (type === "detailed-tax-return") {
    const { from, to } = range(filters);
    const result = await db.query(
      `SELECT j.posting_date::text AS "postingDate",j.entry_number AS "entryNumber",j.reference,a.code AS "accountCode",a.name AS "accountName",
        l.tax_code AS "taxCode",l.debit_minor::float8 AS "debitMinor",l.credit_minor::float8 AS "creditMinor"
       FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
       JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
       WHERE l.organization_id=$1 AND j.status IN ('posted','reversed') AND j.posting_date BETWEEN $2::date AND $3::date
         AND (l.tax_code IS NOT NULL OR COALESCE(a.subtype,'') ILIKE '%tax%')
       ORDER BY j.posting_date,j.entry_number,l.id`, [organizationId, from, to]);
    rows = result.rows;
    totals = { debitMinor: rows.reduce((n, r) => n + Number(r.debitMinor), 0), creditMinor: rows.reduce((n, r) => n + Number(r.creditMinor), 0) };
    columns = ["postingDate","entryNumber","reference","accountCode","accountName","taxCode","debitMinor","creditMinor"];
  } else if (type === "comparative-statements") {
    const current = await ledgerSummary(db, organizationId, filters);
    let prior: LedgerRow[] = [];
    if (filters.from && filters.to) {
      const priorFrom = new Date(`${filters.from}T00:00:00Z`), priorTo = new Date(`${filters.to}T00:00:00Z`);
      priorFrom.setUTCFullYear(priorFrom.getUTCFullYear() - 1); priorTo.setUTCFullYear(priorTo.getUTCFullYear() - 1);
      prior = await ledgerSummary(db, organizationId, { ...filters, from: priorFrom.toISOString().slice(0,10), to: priorTo.toISOString().slice(0,10) });
    }
    const byId = new Map(prior.map((row) => [row.accountId, row]));
    rows = current.map((row) => ({ ...row, currentMinor: normalAmount(row), priorMinor: byId.get(row.accountId) ? normalAmount(byId.get(row.accountId)!) : 0,
      varianceMinor: normalAmount(row) - (byId.get(row.accountId) ? normalAmount(byId.get(row.accountId)!) : 0) }));
    columns = ["code","name","type","currentMinor","priorMinor","varianceMinor"];
  } else if (type === "journal-summary") {
    const { from, to } = range(filters);
    const result = await db.query(
      `SELECT j.source_type AS "sourceType",COUNT(DISTINCT j.id)::int AS "journalCount",COALESCE(SUM(l.debit_minor),0)::float8 AS "debitMinor",
        COALESCE(SUM(l.credit_minor),0)::float8 AS "creditMinor" FROM journal_entries j
       JOIN journal_lines l ON l.journal_entry_id=j.id AND l.organization_id=j.organization_id
       WHERE j.organization_id=$1 AND j.status IN ('posted','reversed') AND j.posting_date BETWEEN $2::date AND $3::date
       GROUP BY j.source_type ORDER BY j.source_type`, [organizationId, from, to]);
    rows = result.rows; columns = ["sourceType","journalCount","debitMinor","creditMinor"];
    totals = { journalCount: rows.reduce((n,r)=>n+Number(r.journalCount),0), debitMinor: rows.reduce((n,r)=>n+Number(r.debitMinor),0), creditMinor: rows.reduce((n,r)=>n+Number(r.creditMinor),0) };
  } else if (type === "document-summary") {
    const { from, to } = range(filters);
    const result = await db.query(
      `SELECT type,status,currency,COUNT(*)::int AS count,COALESCE(SUM(total_minor),0)::float8 AS "totalMinor",
        COALESCE(SUM(paid_minor),0)::float8 AS "paidMinor",COALESCE(SUM(total_minor-paid_minor),0)::float8 AS "outstandingMinor"
       FROM documents WHERE organization_id=$1 AND issue_date BETWEEN $2::date AND $3::date GROUP BY type,status,currency ORDER BY type,status,currency`, [organizationId, from, to]);
    rows = result.rows; columns = ["type","status","currency","count","totalMinor","paidMinor","outstandingMinor"];
  } else if (type === "payments-summary") {
    const { from, to } = range(filters);
    const result = await db.query(
      `SELECT type,status,currency,COUNT(*)::int AS count,COALESCE(SUM(amount_minor),0)::float8 AS "amountMinor",
        COALESCE(SUM((SELECT COALESCE(SUM(pa.amount_minor),0) FROM payment_allocations pa WHERE pa.organization_id=p.organization_id AND pa.payment_id=p.id AND pa.reversed_at IS NULL)),0)::float8 AS "allocatedMinor"
       FROM payments p WHERE organization_id=$1 AND payment_date BETWEEN $2::date AND $3::date GROUP BY type,status,currency ORDER BY type,status,currency`, [organizationId, from, to]);
    rows = result.rows.map((row) => ({ ...row, unallocatedMinor: Number(row.amountMinor)-Number(row.allocatedMinor) }));
    columns = ["type","status","currency","count","amountMinor","allocatedMinor","unallocatedMinor"];
  } else if (type === "contact-balances") {
    const asOf = filters.asOf ?? filters.to ?? new Date().toISOString().slice(0,10);
    const result = await db.query(
      `SELECT c.id AS "contactId",c.code,c.name,c.type,
        COALESCE(SUM(CASE WHEN d.type='invoice' THEN d.total_minor-d.paid_minor ELSE 0 END),0)::float8 AS "receivableMinor",
        COALESCE(SUM(CASE WHEN d.type='bill' THEN d.total_minor-d.paid_minor ELSE 0 END),0)::float8 AS "payableMinor"
       FROM contacts c LEFT JOIN documents d ON d.contact_id=c.id AND d.organization_id=c.organization_id AND d.status IN ('open','partially_paid') AND d.issue_date <= $2::date
       WHERE c.organization_id=$1 AND c.archived_at IS NULL GROUP BY c.id,c.code,c.name,c.type ORDER BY c.name`, [organizationId, asOf]);
    rows = result.rows; columns = ["code","name","type","receivableMinor","payableMinor"];
  } else if (type === "cash-bank-summary") {
    const asOf = filters.asOf ?? filters.to ?? MAX_DATE;
    const result = await db.query(
      `SELECT b.id AS "bankAccountId",b.name,b.bank_name AS "bankName",b.currency,a.code AS "ledgerCode",a.name AS "ledgerName",
        (b.opening_balance_minor+COALESCE(SUM(CASE WHEN j.posting_date <= $2::date AND j.status IN ('posted','reversed') THEN l.debit_minor-l.credit_minor ELSE 0 END),0))::float8 AS "ledgerBalanceMinor",
        COUNT(bt.id) FILTER (WHERE bt.status='unmatched' AND bt.transaction_date <= $2::date)::int AS "unmatchedCount"
       FROM bank_accounts b JOIN accounts a ON a.id=b.ledger_account_id AND a.organization_id=b.organization_id
       LEFT JOIN journal_lines l ON l.account_id=b.ledger_account_id AND l.organization_id=b.organization_id
       LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
       LEFT JOIN bank_transactions bt ON bt.bank_account_id=b.id AND bt.organization_id=b.organization_id
       WHERE b.organization_id=$1 GROUP BY b.id,b.name,b.bank_name,b.currency,b.opening_balance_minor,a.code,a.name ORDER BY b.name`, [organizationId, asOf]);
    rows = result.rows; columns = ["name","bankName","currency","ledgerCode","ledgerName","ledgerBalanceMinor","unmatchedCount"];
  } else if (type === "bank-transactions") {
    const { from, to } = range(filters);
    const result = await db.query(
      `SELECT b.name AS "bankAccount",bt.transaction_date::text AS "transactionDate",bt.description,bt.reference,bt.amount_minor::float8 AS "amountMinor",bt.status,
        j.entry_number AS "matchedJournal",bt.reconciled_at AS "reconciledAt"
       FROM bank_transactions bt JOIN bank_accounts b ON b.id=bt.bank_account_id AND b.organization_id=bt.organization_id
       LEFT JOIN journal_lines l ON l.id=bt.matched_journal_line_id AND l.organization_id=bt.organization_id
       LEFT JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
       WHERE bt.organization_id=$1 AND bt.transaction_date BETWEEN $2::date AND $3::date ORDER BY bt.transaction_date,b.name,bt.id`, [organizationId, from, to]);
    rows = result.rows; columns = ["bankAccount","transactionDate","description","reference","amountMinor","status","matchedJournal","reconciledAt"];
  } else if (type === "fiscal-period-summary") {
    const result = await db.query(
      `SELECT y.name AS "fiscalYear",y.status AS "yearStatus",p.name AS period,p.starts_on::text AS "startsOn",p.ends_on::text AS "endsOn",p.status,
        p.closed_at AS "closedAt",p.locked_at AS "lockedAt"
       FROM fiscal_periods p LEFT JOIN fiscal_years y ON y.id=p.fiscal_year_id AND y.organization_id=p.organization_id
       WHERE p.organization_id=$1 ORDER BY p.starts_on DESC`, [organizationId]);
    rows = result.rows; columns = ["fiscalYear","yearStatus","period","startsOn","endsOn","status","closedAt","lockedAt"];
  } else if (type === "financial-ratios") {
    const asOf = filters.asOf ?? filters.to ?? MAX_DATE;
    const bs = await ledgerSummary(db, organizationId, { ...filters, from: MIN_DATE, to: asOf }, ["asset","liability","equity"]);
    const pl = await ledgerSummary(db, organizationId, filters, ["revenue","expense"]);
    const assets = bs.filter(r=>r.type==="asset").reduce((n,r)=>n+normalAmount(r),0);
    const liabilities = bs.filter(r=>r.type==="liability").reduce((n,r)=>n+normalAmount(r),0);
    const equity = bs.filter(r=>r.type==="equity").reduce((n,r)=>n+normalAmount(r),0);
    const cash = bs.filter(r=>r.type==="asset" && r.subtype==="cash").reduce((n,r)=>n+normalAmount(r),0);
    const receivables = bs.filter(r=>r.type==="asset" && r.subtype==="receivable").reduce((n,r)=>n+normalAmount(r),0);
    const payables = bs.filter(r=>r.type==="liability" && r.subtype==="payable").reduce((n,r)=>n+normalAmount(r),0);
    const revenue = pl.filter(r=>r.type==="revenue").reduce((n,r)=>n+normalAmount(r),0);
    const expenses = pl.filter(r=>r.type==="expense").reduce((n,r)=>n+normalAmount(r),0);
    const profit = revenue-expenses;
    rows = [
      { ratio: "debt-to-equity", value: equity ? liabilities/equity : null },
      { ratio: "cash-to-payables", value: payables ? cash/payables : null },
      { ratio: "receivables-to-revenue", value: revenue ? receivables/revenue : null },
      { ratio: "net-profit-margin", value: revenue ? profit/revenue : null },
      { ratio: "return-on-assets", value: assets ? profit/assets : null },
    ];
    columns = ["ratio","value"];
  } else if (type === "draft-transactions") {
    const result = await db.query(
      `SELECT 'journal' AS source,id,entry_number AS number,posting_date::text AS date,status,description FROM journal_entries WHERE organization_id=$1 AND status='draft'
       UNION ALL SELECT 'document',id,number,issue_date::text,status,type FROM documents WHERE organization_id=$1 AND status='draft'
       UNION ALL SELECT 'payment',id,number,payment_date::text,status,type FROM payments WHERE organization_id=$1 AND status='draft'
       ORDER BY date,source,number`, [organizationId]);
    rows = result.rows; columns = ["source","id","number","date","status","description"];
  } else if (type === "audit-trail") {
    const { from, to } = range(filters);
    const result = await db.query(
      `SELECT created_at AS "createdAt",actor_id AS "actorId",action,entity_type AS "entityType",entity_id AS "entityId",before_data AS "before",after_data AS "after"
       FROM audit_logs WHERE organization_id=$1 AND created_at::date BETWEEN $2::date AND $3::date
         AND (entity_type IN ('account','journal','document','payment','contact','bank_account','bank_transaction','reconciliation') OR action LIKE 'finance.%' OR action LIKE 'payment.%' OR action LIKE 'document.%')
       ORDER BY created_at DESC LIMIT 20000`, [organizationId, from, to]);
    rows = result.rows; columns = ["createdAt","actorId","action","entityType","entityId","before","after"];
  }

  return { reportType: type, generatedAt, filters, columns, rows, ...(totals ? { totals } : {}) };
}

export function toCsv(report: ReportResult): string {
  const escape = (value: unknown) => {
    const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
  };
  return [report.columns.join(","), ...report.rows.map((row) => report.columns.map((column) => escape(row[column])).join(","))].join("\n");
}
