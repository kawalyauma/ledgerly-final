import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRuntime, type Runtime } from "../src/runtime.js";
import { checkBudget, createBudget, createForecast, forecastVariance, generateBudgetVsActualReport, refreshBudgetActuals, transitionBudget } from "../src/features/budgets/service.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("budgets forecasting and variance", () => {
  let runtime: Runtime;
  const org = "org_budget_test";
  let budgetId = "";

  beforeAll(async () => {
    runtime = await createRuntime();
    await runtime.db.query("TRUNCATE backend_outbox_events, audit_logs, users, organizations CASCADE");
    await runtime.db.query(`INSERT INTO organizations(id,name,base_currency,status) VALUES($1,'Budget Test','UGX','active')`, [org]);
    await runtime.db.query(`INSERT INTO accounts(id,organization_id,code,name,type,subtype,normal_balance) VALUES
      ('acc_budget_rev',$1,'4000','Sales Revenue','revenue','sales','credit'),
      ('acc_budget_exp',$1,'6000','Operating Expense','expense','operating','debit')`, [org]);
    await runtime.db.query(`INSERT INTO cost_centers(id,organization_id,code,name) VALUES('cc_ops',$1,'OPS','Operations')`, [org]);
    await runtime.db.query(`INSERT INTO revenue_sources(id,organization_id,code,name,revenue_account_id) VALUES('rs_fees',$1,'FEES','Fees Revenue','acc_budget_rev')`, [org]);

    await runtime.db.query(`INSERT INTO journal_entries(id,organization_id,entry_number,transaction_date,posting_date,description,status,currency,posted_at,posted_by)
      VALUES('j_budget_sep',$1,'JE-BUD-1','2026-09-15','2026-09-15','September actuals','posted','UGX',CURRENT_TIMESTAMP,'tester')`, [org]);
    await runtime.db.query(`INSERT INTO journal_lines(id,organization_id,journal_entry_id,account_id,debit_minor,credit_minor,base_debit_minor,base_credit_minor,dimensions_json)
      VALUES('jl_budget_rev',$1,'j_budget_sep','acc_budget_rev',0,120000,0,120000,$2::jsonb),
            ('jl_budget_exp',$1,'j_budget_sep','acc_budget_exp',70000,0,70000,0,$3::jsonb)`,
      [org, JSON.stringify({ costCenterId: "cc_ops", revenueSourceId: "rs_fees" }), JSON.stringify({ costCenterId: "cc_ops" })]);

    const budget = await createBudget(runtime, org, "tester", {
      name: "FY2026 Operating Budget", fiscalYear: 2026, scenario: "base", kind: "annual", enforcement: "warning",
      lines: [
        { accountId: "acc_budget_rev", period: "2026-09", amountMinor: 100000, costCenterId: "cc_ops", revenueSourceId: "rs_fees" },
        { accountId: "acc_budget_exp", period: "2026-09", amountMinor: 60000, costCenterId: "cc_ops" },
        { accountId: "acc_budget_rev", period: "2026-10", amountMinor: 110000, costCenterId: "cc_ops", revenueSourceId: "rs_fees" },
        { accountId: "acc_budget_exp", period: "2026-10", amountMinor: 65000, costCenterId: "cc_ops" },
      ],
    });
    budgetId = budget.id;
    await transitionBudget(runtime, org, "tester", budgetId, "submit");
    await transitionBudget(runtime, org, "approver", budgetId, "approve");
    await transitionBudget(runtime, org, "approver", budgetId, "activate");
  });

  afterAll(async () => { await runtime?.close(); });

  it("refreshes actuals and produces budget versus actual variance", async () => {
    expect(await refreshBudgetActuals(runtime, org, budgetId)).toBe(4);
    const report = await generateBudgetVsActualReport(runtime, org, { budgetId, from: "2026-09-01", to: "2026-09-30" });
    const revenue = report.rows.find((row) => row.accountCode === "4000")!;
    const expense = report.rows.find((row) => row.accountCode === "6000")!;
    expect(revenue).toMatchObject({ budgetMinor: 100000, actualMinor: 120000, varianceMinor: 20000, favorable: true });
    expect(expense).toMatchObject({ budgetMinor: 60000, actualMinor: 70000, varianceMinor: 10000, favorable: false });
    expect(report.totals).toMatchObject({ budgetMinor: 160000, actualMinor: 190000, varianceMinor: 30000 });
  });

  it("returns warning enforcement when proposed spend exceeds plan", async () => {
    const result = await checkBudget(runtime, org, budgetId, { accountId: "acc_budget_exp", period: "2026-09", amountMinor: 10000, costCenterId: "cc_ops" });
    expect(result).toMatchObject({ budgetMinor: 60000, actualMinor: 70000, projectedMinor: 80000, exceeded: true, action: "warn" });
  });

  it("creates an actuals-plus-plan forecast and compares it to actuals", async () => {
    const forecast = await createForecast(runtime, org, "tester", budgetId, {
      name: "October rolling forecast", scenario: "base", method: "actuals_plus_plan", asOfMonth: "2026-09",
    });
    expect(forecast).toMatchObject({ budgetId, method: "actuals_plus_plan", lineCount: 4, status: "draft" });
    const variance = await forecastVariance(runtime, org, forecast.id);
    const septemberRevenue = variance.lines.find((row: Record<string, unknown>) => row.period === "2026-09" && row.accountCode === "4000");
    const octoberRevenue = variance.lines.find((row: Record<string, unknown>) => row.period === "2026-10" && row.accountCode === "4000");
    expect(septemberRevenue).toMatchObject({ forecastMinor: 120000, actualMinor: 120000, varianceMinor: 0 });
    expect(octoberRevenue).toMatchObject({ forecastMinor: 110000, actualMinor: 0, varianceMinor: -110000 });
  });
});
