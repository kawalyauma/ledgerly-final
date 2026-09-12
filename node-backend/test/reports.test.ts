import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRuntime, type Runtime } from "../src/runtime.js";
import { generateReport, reportCatalog } from "../src/features/reports/service.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("financial reports", () => {
  let runtime: Runtime;
  const org = "org_reports_test";

  beforeAll(async () => {
    runtime = await createRuntime();
    await runtime.db.query("TRUNCATE backend_outbox_events, audit_logs, users, organizations CASCADE");
    await runtime.db.query(`INSERT INTO organizations(id,name,base_currency,status) VALUES($1,'Reports Test','UGX','active')`, [org]);
    const accounts = [
      ["acc_cash","1000","Cash","asset","cash","debit"],
      ["acc_ar","1100","Accounts Receivable","asset","receivable","debit"],
      ["acc_ap","2000","Accounts Payable","liability","payable","credit"],
      ["acc_equity","3000","Equity","equity","capital","credit"],
      ["acc_rev","4000","Revenue","revenue","sales","credit"],
      ["acc_exp","5000","Expense","expense","operating","debit"],
    ];
    for (const row of accounts) {
      await runtime.db.query(`INSERT INTO accounts(id,organization_id,code,name,type,subtype,normal_balance) VALUES($1,$2,$3,$4,$5,$6,$7)`, [row[0],org,...row.slice(1)]);
    }
    await runtime.db.query(`INSERT INTO contacts(id,organization_id,type,code,name) VALUES
      ('contact_customer',$1,'customer','CUS-1','Customer One'),('contact_supplier',$1,'supplier','SUP-1','Supplier One')`, [org]);

    const journals = [
      ["j_inv","JE-00000001","invoice","doc_inv","2026-09-01","Invoice INV-1"],
      ["j_receipt","JE-00000002","receipt","pay_receipt","2026-09-05","Receipt RCPT-1"],
      ["j_bill","JE-00000003","bill","doc_bill","2026-09-02","Bill BILL-1"],
    ];
    for (const row of journals) {
      await runtime.db.query(`INSERT INTO journal_entries(id,organization_id,entry_number,transaction_date,posting_date,description,source_type,source_id,status,currency,posted_at,posted_by)
        VALUES($1,$2,$3,$5::date,$5::date,$6,$4,$7,'posted','UGX',CURRENT_TIMESTAMP,'tester')`, [row[0],org,row[1],row[2],row[4],row[5],row[3]]);
    }
    const lines = [
      ["jl_inv_ar","j_inv","acc_ar",100000,0,"contact_customer"],
      ["jl_inv_rev","j_inv","acc_rev",0,100000,"contact_customer"],
      ["jl_receipt_cash","j_receipt","acc_cash",40000,0,"contact_customer"],
      ["jl_receipt_ar","j_receipt","acc_ar",0,40000,"contact_customer"],
      ["jl_bill_exp","j_bill","acc_exp",30000,0,"contact_supplier"],
      ["jl_bill_ap","j_bill","acc_ap",0,30000,"contact_supplier"],
    ];
    for (const row of lines) {
      await runtime.db.query(`INSERT INTO journal_lines(id,organization_id,journal_entry_id,account_id,debit_minor,credit_minor,base_debit_minor,base_credit_minor,contact_id)
        VALUES($1,$2,$3,$4,$5,$6,$5,$6,$7)`, [row[0],org,row[1],row[2],row[3],row[4],row[5]]);
    }

    await runtime.db.query(`INSERT INTO documents(id,organization_id,type,number,contact_id,issue_date,due_date,status,currency,subtotal_minor,tax_minor,total_minor,paid_minor,journal_entry_id)
      VALUES('doc_inv',$1,'invoice','INV-1','contact_customer','2026-09-01','2026-09-10','open','UGX',100000,0,100000,0,'j_inv'),
            ('doc_bill',$1,'bill','BILL-1','contact_supplier','2026-09-02','2026-09-12','open','UGX',30000,0,30000,0,'j_bill')`, [org]);
    await runtime.db.query(`INSERT INTO payments(id,organization_id,type,number,contact_id,bank_account_id,control_account_id,payment_date,currency,amount_minor,status,journal_entry_id,idempotency_key)
      VALUES('pay_receipt',$1,'receipt','RCPT-1','contact_customer','acc_cash','acc_ar','2026-09-05','UGX',40000,'posted','j_receipt','reports-receipt')`, [org]);
    await runtime.db.query(`INSERT INTO payment_allocations(id,organization_id,payment_id,document_id,amount_minor)
      VALUES('pal_reports',$1,'pay_receipt','doc_inv',40000)`, [org]);

    await runtime.db.query(`INSERT INTO bank_accounts(id,organization_id,ledger_account_id,name,bank_name,currency,opening_balance_minor)
      VALUES('bank_1',$1,'acc_cash','Operating Account','Test Bank','UGX',0)`, [org]);
    await runtime.db.query(`INSERT INTO bank_statement_imports(id,organization_id,bank_account_id,filename,statement_start,statement_end,opening_balance_minor,closing_balance_minor,transaction_count,duplicate_count,import_fingerprint,imported_by)
      VALUES('bsi_1',$1,'bank_1','statement.csv','2026-09-01','2026-09-30',0,40000,1,0,'reports-fingerprint','tester')`, [org]);
    await runtime.db.query(`INSERT INTO bank_transactions(id,organization_id,bank_account_id,import_id,external_id,transaction_date,description,amount_minor,status,matched_journal_line_id,matched_at,matched_by)
      VALUES('btx_1',$1,'bank_1','bsi_1','ext-1','2026-09-05','Receipt RCPT-1',40000,'matched','jl_receipt_cash',CURRENT_TIMESTAMP,'tester')`, [org]);
    await runtime.db.query(`INSERT INTO bank_reconciliations(id,organization_id,bank_account_id,statement_date,statement_balance_minor,ledger_balance_minor,difference_minor,matched_count,unmatched_count,status,prepared_by,completed_at)
      VALUES('rec_1',$1,'bank_1','2026-09-30',40000,40000,0,1,0,'completed','tester',CURRENT_TIMESTAMP)`, [org]);
  });

  afterAll(async () => { await runtime?.close(); });

  it("publishes a broad migrated report catalog", () => {
    expect(reportCatalog.filter((report) => report.available).length).toBeGreaterThanOrEqual(30);
    expect(reportCatalog.some((report) => report.id === "profit-loss" && report.available)).toBe(true);
    expect(reportCatalog.some((report) => report.id === "inventory-valuation" && !report.available)).toBe(true);
  });

  it("produces balanced core financial statements", async () => {
    const filters = { from: "2026-09-01", to: "2026-09-30" };
    const trial = await generateReport(runtime, org, "trial-balance", filters);
    expect(trial.totals?.debitMinor).toBe(170000);
    expect(trial.totals?.creditMinor).toBe(170000);

    const pl = await generateReport(runtime, org, "profit-loss", filters);
    expect(pl.totals).toMatchObject({ revenueMinor: 100000, expenseMinor: 30000, netProfitMinor: 70000 });

    const balance = await generateReport(runtime, org, "balance-sheet", { asOf: "2026-09-30" });
    expect(balance.totals?.differenceMinor).toBe(0);
    expect(balance.totals).toMatchObject({ assetMinor: 100000, liabilityMinor: 30000, equityMinor: 70000 });

    const cash = await generateReport(runtime, org, "cash-flow", filters);
    expect(cash.totals?.netCashChangeMinor).toBe(40000);
  });

  it("reports partial receivables, payables and banking reconciliation", async () => {
    const ar = await generateReport(runtime, org, "receivables-ageing", { asOf: "2026-09-30" });
    expect(ar.totals?.outstandingMinor).toBe(60000);
    expect(ar.rows[0]?.bucket).toBe("1-30");

    const ap = await generateReport(runtime, org, "payables-ageing", { asOf: "2026-09-30" });
    expect(ap.totals?.outstandingMinor).toBe(30000);

    const contacts = await generateReport(runtime, org, "contact-balances", { asOf: "2026-09-30" });
    expect(contacts.rows.find((row) => row.contactId === "contact_customer")?.receivableMinor).toBe(60000);

    const reconciliation = await generateReport(runtime, org, "bank-reconciliation", { asOf: "2026-09-30" });
    expect(reconciliation.rows[0]).toMatchObject({ status: "completed", differenceMinor: 0, matchedCount: 1, unmatchedCount: 0 });
  });
});
