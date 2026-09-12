import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import type { ReportFilters, ReportResult } from "../reports/service.js";

type Db = Pool | PoolClient;

export type BudgetLineInput = {
  accountId: string;
  period: string;
  amountMinor: number;
  costCenterId?: string;
  revenueSourceId?: string;
  projectId?: string;
  classId?: string;
  departmentId?: string;
  locationId?: string;
  notes?: string;
};

export type BudgetReportFilters = ReportFilters & {
  budgetId?: string;
  scenario?: string;
  costCenterId?: string;
  revenueSourceId?: string;
};

async function audit(db: Db, organizationId: string, actorId: string, action: string, entityType: string, entityId: string, after?: unknown) {
  await db.query(
    `INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [createId("aud"), organizationId, actorId, action, entityType, entityId, after === undefined ? null : JSON.stringify(after)],
  );
}

async function validateLines(runtime: Runtime, organizationId: string, lines: BudgetLineInput[]): Promise<void> {
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const accounts = await runtime.db.query<{ id: string; type: string; active: boolean }>(
    `SELECT id,type,active FROM accounts WHERE organization_id=$1 AND id=ANY($2::text[])`, [organizationId, accountIds],
  );
  if (accounts.rows.length !== accountIds.length) throw new AppError(422, "INVALID_ACCOUNT", "Every budget account must belong to the organization");
  if (accounts.rows.some((row) => !row.active)) throw new AppError(422, "INACTIVE_ACCOUNT", "Budget lines cannot use inactive accounts");

  const costCenterIds = [...new Set(lines.flatMap((line) => line.costCenterId ? [line.costCenterId] : []))];
  if (costCenterIds.length) {
    const found = await runtime.db.query("SELECT id FROM cost_centers WHERE organization_id=$1 AND active=true AND id=ANY($2::text[])", [organizationId, costCenterIds]);
    if (found.rows.length !== costCenterIds.length) throw new AppError(422, "INVALID_COST_CENTER", "Every cost center must belong to the organization and be active");
  }

  const revenueSourceIds = [...new Set(lines.flatMap((line) => line.revenueSourceId ? [line.revenueSourceId] : []))];
  if (revenueSourceIds.length) {
    const found = await runtime.db.query<{ id: string; revenueAccountId: string }>(
      `SELECT id,revenue_account_id AS "revenueAccountId" FROM revenue_sources WHERE organization_id=$1 AND active=true AND id=ANY($2::text[])`,
      [organizationId, revenueSourceIds],
    );
    if (found.rows.length !== revenueSourceIds.length) throw new AppError(422, "INVALID_REVENUE_SOURCE", "Every revenue source must belong to the organization and be active");
    const accountBySource = new Map(found.rows.map((row) => [row.id, row.revenueAccountId]));
    const mismatch = lines.find((line) => line.revenueSourceId && accountBySource.get(line.revenueSourceId) !== line.accountId);
    if (mismatch) throw new AppError(422, "REVENUE_SOURCE_ACCOUNT_MISMATCH", "A revenue-source budget line must use the revenue account linked to that source");
  }
}

async function insertLines(client: PoolClient, organizationId: string, budgetId: string, lines: BudgetLineInput[]) {
  for (const line of lines) {
    await client.query(
      `INSERT INTO budget_lines(id,organization_id,budget_id,account_id,period,amount_minor,cost_center_id,revenue_source_id,project_id,class_id,department_id,location_id,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [createId("bdl"), organizationId, budgetId, line.accountId, line.period, line.amountMinor, line.costCenterId ?? null,
       line.revenueSourceId ?? null, line.projectId ?? null, line.classId ?? null, line.departmentId ?? null, line.locationId ?? null, line.notes ?? null],
    );
  }
}

export async function createBudget(runtime: Runtime, organizationId: string, actorId: string, input: {
  name: string; fiscalYear: number; fiscalYearId?: string; scenario?: string; kind?: string; enforcement?: string; metadata?: Record<string, unknown>; lines: BudgetLineInput[];
}) {
  await validateLines(runtime, organizationId, input.lines);
  if (input.fiscalYearId) {
    const fy = await runtime.db.query("SELECT 1 FROM fiscal_years WHERE id=$1 AND organization_id=$2", [input.fiscalYearId, organizationId]);
    if (!fy.rowCount) throw new AppError(422, "INVALID_FISCAL_YEAR", "Fiscal year not found");
  }
  const client = await runtime.db.connect();
  const id = createId("bdg");
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO budgets(id,organization_id,name,fiscal_year,fiscal_year_id,scenario,kind,enforcement,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [id, organizationId, input.name, input.fiscalYear, input.fiscalYearId ?? null, input.scenario ?? "base", input.kind ?? "annual",
       input.enforcement ?? "warning", JSON.stringify(input.metadata ?? {})],
    );
    await insertLines(client, organizationId, id, input.lines);
    await audit(client, organizationId, actorId, "budget.created", "budget", id, { name: input.name, fiscalYear: input.fiscalYear, lineCount: input.lines.length });
    await client.query("COMMIT");
    return { id, status: "draft" as const, name: input.name, fiscalYear: input.fiscalYear, scenario: input.scenario ?? "base", kind: input.kind ?? "annual" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function replaceBudgetLines(runtime: Runtime, organizationId: string, actorId: string, budgetId: string, lines: BudgetLineInput[], name?: string, enforcement?: string) {
  await validateLines(runtime, organizationId, lines);
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const budget = (await client.query<{ status: string; lockedAt: Date | null }>(
      `SELECT status,locked_at AS "lockedAt" FROM budgets WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [budgetId, organizationId],
    )).rows[0];
    if (!budget) throw new AppError(404, "NOT_FOUND", "Budget not found");
    if (budget.lockedAt || !["draft","rejected"].includes(budget.status)) throw new AppError(409, "BUDGET_LOCKED", "Only unlocked draft or rejected budgets can be edited");
    if (name || enforcement) await client.query(
      `UPDATE budgets SET name=COALESCE($1,name),enforcement=COALESCE($2,enforcement),updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND organization_id=$4`,
      [name ?? null, enforcement ?? null, budgetId, organizationId],
    );
    await client.query("DELETE FROM budget_lines WHERE budget_id=$1 AND organization_id=$2", [budgetId, organizationId]);
    await insertLines(client, organizationId, budgetId, lines);
    await audit(client, organizationId, actorId, "budget.updated", "budget", budgetId, { lineCount: lines.length });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function transitionBudget(runtime: Runtime, organizationId: string, actorId: string, budgetId: string, action: "submit"|"approve"|"reject"|"activate"|"archive"|"lock"|"unlock", reason?: string) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const budget = (await client.query<{ status: string; lockedAt: Date | null; fiscalYear: number; scenario: string; kind: string }>(
      `SELECT status,locked_at AS "lockedAt",fiscal_year AS "fiscalYear",scenario,kind FROM budgets WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [budgetId, organizationId],
    )).rows[0];
    if (!budget) throw new AppError(404, "NOT_FOUND", "Budget not found");
    if (action === "submit") {
      if (budget.status !== "draft" || budget.lockedAt) throw new AppError(409, "INVALID_STATE", "Only an unlocked draft budget can be submitted");
      await client.query(`UPDATE budgets SET status='submitted',submitted_by=$1,submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [actorId,budgetId]);
    } else if (action === "approve") {
      if (!["draft","submitted"].includes(budget.status)) throw new AppError(409, "INVALID_STATE", "Only draft or submitted budgets can be approved");
      await client.query(`UPDATE budgets SET status='approved',approved_by=$1,approved_at=CURRENT_TIMESTAMP,rejected_by=NULL,rejected_at=NULL,rejection_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [actorId,budgetId]);
    } else if (action === "reject") {
      if (budget.status !== "submitted") throw new AppError(409, "INVALID_STATE", "Only submitted budgets can be rejected");
      if (!reason) throw new AppError(422, "REASON_REQUIRED", "A rejection reason is required");
      await client.query(`UPDATE budgets SET status='rejected',rejected_by=$1,rejected_at=CURRENT_TIMESTAMP,rejection_reason=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3`, [actorId,reason,budgetId]);
    } else if (action === "activate") {
      if (budget.status !== "approved") throw new AppError(409, "INVALID_STATE", "Only approved budgets can be activated");
      await client.query(`UPDATE budgets SET status='archived',locked_at=COALESCE(locked_at,CURRENT_TIMESTAMP),locked_by=COALESCE(locked_by,$1),updated_at=CURRENT_TIMESTAMP
        WHERE organization_id=$2 AND fiscal_year=$3 AND scenario=$4 AND kind=$5 AND status='active' AND id<>$6`, [actorId,organizationId,budget.fiscalYear,budget.scenario,budget.kind,budgetId]);
      await client.query(`UPDATE budgets SET status='active',activated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [budgetId]);
    } else if (action === "archive") {
      await client.query(`UPDATE budgets SET status='archived',locked_at=COALESCE(locked_at,CURRENT_TIMESTAMP),locked_by=COALESCE(locked_by,$1),updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [actorId,budgetId]);
    } else if (action === "lock") {
      await client.query(`UPDATE budgets SET locked_at=COALESCE(locked_at,CURRENT_TIMESTAMP),locked_by=COALESCE(locked_by,$1),updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [actorId,budgetId]);
    } else {
      if (budget.status === "archived") throw new AppError(409, "BUDGET_LOCKED", "Archived budgets cannot be unlocked");
      await client.query(`UPDATE budgets SET locked_at=NULL,locked_by=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [budgetId]);
    }
    await audit(client, organizationId, actorId, `budget.${action}`, "budget", budgetId, reason ? { reason } : undefined);
    await client.query("COMMIT");
    return { id: budgetId, action };
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
}

export async function reviseBudget(runtime: Runtime, organizationId: string, actorId: string, budgetId: string, input: {
  name?: string; scenario?: string; kind?: string; enforcement?: string; lines: BudgetLineInput[];
}) {
  await validateLines(runtime, organizationId, input.lines);
  const old = (await runtime.db.query<{ name: string; fiscalYear: number; fiscalYearId: string | null; version: number; status: string; scenario: string; kind: string; enforcement: string }>(
    `SELECT name,fiscal_year AS "fiscalYear",fiscal_year_id AS "fiscalYearId",version,status,scenario,kind,enforcement FROM budgets WHERE id=$1 AND organization_id=$2`, [budgetId, organizationId],
  )).rows[0];
  if (!old) throw new AppError(404, "NOT_FOUND", "Budget not found");
  if (old.status === "archived") throw new AppError(409, "BUDGET_LOCKED", "Archived budgets cannot be revised");
  const client = await runtime.db.connect();
  const id = createId("bdg");
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO budgets(id,organization_id,name,fiscal_year,fiscal_year_id,status,version,scenario,kind,enforcement,parent_id)
       VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10)`,
      [id,organizationId,input.name ?? old.name,old.fiscalYear,old.fiscalYearId,old.version+1,input.scenario ?? old.scenario,input.kind ?? old.kind,input.enforcement ?? old.enforcement,budgetId],
    );
    await insertLines(client, organizationId, id, input.lines);
    await audit(client, organizationId, actorId, "budget.revised", "budget", id, { parentId: budgetId, version: old.version + 1 });
    await client.query("COMMIT");
    return { id, parentId: budgetId, version: old.version + 1, status: "draft" as const };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function refreshBudgetActuals(runtime: Runtime, organizationId: string, budgetId: string): Promise<number> {
  const exists = await runtime.db.query("SELECT 1 FROM budgets WHERE id=$1 AND organization_id=$2", [budgetId, organizationId]);
  if (!exists.rowCount) throw new AppError(404, "NOT_FOUND", "Budget not found");
  const result = await runtime.db.query(
    `INSERT INTO budget_actuals(budget_line_id,organization_id,budget_id,actual_minor,calculated_at)
     SELECT bl.id,bl.organization_id,bl.budget_id,
       COALESCE(SUM(CASE WHEN a.normal_balance='credit' THEN jl.base_credit_minor-jl.base_debit_minor ELSE jl.base_debit_minor-jl.base_credit_minor END),0),CURRENT_TIMESTAMP
     FROM budget_lines bl
     JOIN accounts a ON a.id=bl.account_id AND a.organization_id=bl.organization_id
     LEFT JOIN journal_entries j ON j.organization_id=bl.organization_id AND j.status IN ('posted','reversed') AND to_char(j.posting_date,'YYYY-MM')=bl.period
     LEFT JOIN journal_lines jl ON jl.journal_entry_id=j.id AND jl.organization_id=j.organization_id AND jl.account_id=bl.account_id
       AND (bl.project_id IS NULL OR jl.project_id=bl.project_id)
       AND (bl.class_id IS NULL OR jl.class_id=bl.class_id)
       AND (bl.department_id IS NULL OR jl.department_id=bl.department_id)
       AND (bl.location_id IS NULL OR jl.location_id=bl.location_id)
       AND (bl.cost_center_id IS NULL OR jl.dimensions_json->>'costCenterId'=bl.cost_center_id)
       AND (bl.revenue_source_id IS NULL OR jl.dimensions_json->>'revenueSourceId'=bl.revenue_source_id)
     WHERE bl.organization_id=$1 AND bl.budget_id=$2
     GROUP BY bl.id,bl.organization_id,bl.budget_id,a.normal_balance
     ON CONFLICT (budget_line_id) DO UPDATE SET actual_minor=EXCLUDED.actual_minor,calculated_at=CURRENT_TIMESTAMP`,
    [organizationId,budgetId],
  );
  return result.rowCount ?? 0;
}

export async function refreshEligibleBudgets(runtime: Runtime): Promise<number> {
  const budgets = await runtime.db.query<{ id: string; organizationId: string }>(
    `SELECT id,organization_id AS "organizationId" FROM budgets WHERE status IN ('approved','active') ORDER BY updated_at DESC LIMIT 250`,
  );
  for (const budget of budgets.rows) await refreshBudgetActuals(runtime, budget.organizationId, budget.id);
  return budgets.rows.length;
}

export async function budgetVariance(runtime: Runtime, organizationId: string, budgetId: string) {
  await refreshBudgetActuals(runtime, organizationId, budgetId);
  const result = await runtime.db.query(
    `SELECT bl.id AS "budgetLineId",bl.period,a.id AS "accountId",a.code AS "accountCode",a.name AS "accountName",a.type AS "accountType",
      cc.id AS "costCenterId",cc.code AS "costCenterCode",cc.name AS "costCenter",rs.id AS "revenueSourceId",rs.code AS "revenueSourceCode",rs.name AS "revenueSource",
      bl.amount_minor::float8 AS "budgetMinor",COALESCE(ba.actual_minor,0)::float8 AS "actualMinor",bl.notes
     FROM budget_lines bl JOIN accounts a ON a.id=bl.account_id AND a.organization_id=bl.organization_id
     LEFT JOIN budget_actuals ba ON ba.budget_line_id=bl.id
     LEFT JOIN cost_centers cc ON cc.id=bl.cost_center_id AND cc.organization_id=bl.organization_id
     LEFT JOIN revenue_sources rs ON rs.id=bl.revenue_source_id AND rs.organization_id=bl.organization_id
     WHERE bl.organization_id=$1 AND bl.budget_id=$2 ORDER BY bl.period,a.code,cc.code NULLS FIRST,rs.code NULLS FIRST`, [organizationId,budgetId],
  );
  return result.rows.map((row) => {
    const budget = Number(row.budgetMinor), actual = Number(row.actualMinor), variance = actual-budget, type = String(row.accountType);
    return { ...row, varianceMinor: variance, variancePercent: budget ? (variance/budget)*100 : null,
      favorable: type === "revenue" ? variance >= 0 : type === "expense" ? variance <= 0 : null };
  });
}

export async function generateBudgetVsActualReport(runtime: Runtime, organizationId: string, filters: BudgetReportFilters): Promise<ReportResult> {
  let budgetId = filters.budgetId;
  if (!budgetId) {
    const picked = (await runtime.db.query<{ id: string }>(
      `SELECT id FROM budgets WHERE organization_id=$1 AND ($2::text IS NULL OR scenario=$2) AND status IN ('active','approved')
       ORDER BY (status='active') DESC,fiscal_year DESC,version DESC,updated_at DESC LIMIT 1`, [organizationId,filters.scenario ?? null],
    )).rows[0];
    if (!picked) throw new AppError(404, "BUDGET_NOT_FOUND", "No active or approved budget is available for this report");
    budgetId = picked.id;
  }
  await refreshBudgetActuals(runtime, organizationId, budgetId);
  const params: unknown[] = [organizationId,budgetId];
  const where = ["bl.organization_id=$1","bl.budget_id=$2"];
  const fromMonth = filters.from?.slice(0,7), toMonth = (filters.to ?? filters.asOf)?.slice(0,7);
  if (fromMonth) { params.push(fromMonth); where.push(`bl.period >= $${params.length}`); }
  if (toMonth) { params.push(toMonth); where.push(`bl.period <= $${params.length}`); }
  if (filters.accountId) { params.push(filters.accountId); where.push(`bl.account_id=$${params.length}`); }
  if (filters.projectId) { params.push(filters.projectId); where.push(`bl.project_id=$${params.length}`); }
  if (filters.costCenterId) { params.push(filters.costCenterId); where.push(`bl.cost_center_id=$${params.length}`); }
  if (filters.revenueSourceId) { params.push(filters.revenueSourceId); where.push(`bl.revenue_source_id=$${params.length}`); }
  const header = (await runtime.db.query<{ name: string; scenario: string; kind: string; fiscalYear: number }>(
    `SELECT name,scenario,kind,fiscal_year AS "fiscalYear" FROM budgets WHERE id=$1 AND organization_id=$2`, [budgetId,organizationId],
  )).rows[0];
  if (!header) throw new AppError(404, "BUDGET_NOT_FOUND", "Budget not found");
  const result = await runtime.db.query(
    `SELECT bl.period,a.code AS "accountCode",a.name AS "accountName",a.type AS "accountType",cc.code AS "costCenterCode",cc.name AS "costCenter",
      rs.code AS "revenueSourceCode",rs.name AS "revenueSource",SUM(bl.amount_minor)::float8 AS "budgetMinor",SUM(COALESCE(ba.actual_minor,0))::float8 AS "actualMinor"
     FROM budget_lines bl JOIN accounts a ON a.id=bl.account_id AND a.organization_id=bl.organization_id
     LEFT JOIN budget_actuals ba ON ba.budget_line_id=bl.id
     LEFT JOIN cost_centers cc ON cc.id=bl.cost_center_id AND cc.organization_id=bl.organization_id
     LEFT JOIN revenue_sources rs ON rs.id=bl.revenue_source_id AND rs.organization_id=bl.organization_id
     WHERE ${where.join(" AND ")}
     GROUP BY bl.period,a.code,a.name,a.type,cc.code,cc.name,rs.code,rs.name ORDER BY bl.period,a.code,cc.code NULLS FIRST,rs.code NULLS FIRST`, params,
  );
  const rows = result.rows.map((row) => {
    const budget = Number(row.budgetMinor), actual = Number(row.actualMinor), variance = actual-budget, type = String(row.accountType);
    return { budgetName: header.name, scenario: header.scenario, fiscalYear: header.fiscalYear, ...row,
      varianceMinor: variance, variancePercent: budget ? (variance/budget)*100 : null,
      favorable: type === "revenue" ? variance >= 0 : type === "expense" ? variance <= 0 : null };
  });
  const budgetMinor = rows.reduce((n,row)=>n+Number(row.budgetMinor),0), actualMinor = rows.reduce((n,row)=>n+Number(row.actualMinor),0);
  return {
    reportType: "budget-vs-actual" as never,
    generatedAt: new Date().toISOString(), filters,
    columns: ["budgetName","scenario","fiscalYear","period","accountCode","accountName","accountType","costCenterCode","costCenter","revenueSourceCode","revenueSource","budgetMinor","actualMinor","varianceMinor","variancePercent","favorable"],
    rows,
    totals: { budgetMinor, actualMinor, varianceMinor: actualMinor-budgetMinor },
  };
}

function dimensionKey(line: { accountId: string; costCenterId?: string|null; revenueSourceId?: string|null; projectId?: string|null; classId?: string|null; departmentId?: string|null; locationId?: string|null }) {
  return [line.accountId,line.costCenterId??"",line.revenueSourceId??"",line.projectId??"",line.classId??"",line.departmentId??"",line.locationId??""].join("|");
}

export async function createForecast(runtime: Runtime, organizationId: string, actorId: string, budgetId: string, input: {
  name: string; scenario?: string; method?: "manual"|"actuals_plus_plan"|"run_rate"|"percentage"; asOfMonth?: string; adjustmentPercent?: number;
  assumptions?: Record<string, unknown>; lines?: BudgetLineInput[];
}) {
  const budget = (await runtime.db.query<{ id: string }>("SELECT id FROM budgets WHERE id=$1 AND organization_id=$2", [budgetId,organizationId])).rows[0];
  if (!budget) throw new AppError(404, "NOT_FOUND", "Budget not found");
  const method = input.method ?? "manual";
  await refreshBudgetActuals(runtime, organizationId, budgetId);
  let lines: Array<BudgetLineInput & { source: string }> = [];
  if (method === "manual") {
    if (!input.lines?.length) throw new AppError(422, "FORECAST_LINES_REQUIRED", "Manual forecasts require at least one line");
    await validateLines(runtime, organizationId, input.lines);
    lines = input.lines.map((line) => ({ ...line, source: "manual" }));
  } else {
    const source = await runtime.db.query<{
      accountId:string; period:string; amountMinor:number; actualMinor:number; costCenterId:string|null; revenueSourceId:string|null;
      projectId:string|null; classId:string|null; departmentId:string|null; locationId:string|null;
    }>(`SELECT bl.account_id AS "accountId",bl.period,bl.amount_minor::float8 AS "amountMinor",COALESCE(ba.actual_minor,0)::float8 AS "actualMinor",
        bl.cost_center_id AS "costCenterId",bl.revenue_source_id AS "revenueSourceId",bl.project_id AS "projectId",bl.class_id AS "classId",
        bl.department_id AS "departmentId",bl.location_id AS "locationId"
       FROM budget_lines bl LEFT JOIN budget_actuals ba ON ba.budget_line_id=bl.id WHERE bl.organization_id=$1 AND bl.budget_id=$2 ORDER BY bl.period,bl.id`, [organizationId,budgetId]);
    const asOf = input.asOfMonth ?? new Date().toISOString().slice(0,7);
    const averages = new Map<string,{sum:number;count:number}>();
    if (method === "run_rate") {
      for (const line of source.rows.filter((row)=>row.period<=asOf)) {
        const key=dimensionKey(line), current=averages.get(key)??{sum:0,count:0}; current.sum+=Number(line.actualMinor); current.count+=1; averages.set(key,current);
      }
    }
    lines = source.rows.map((line) => {
      let amount = Number(line.amountMinor), sourceType = "budget";
      if (method === "actuals_plus_plan") { if (line.period <= asOf) { amount=Number(line.actualMinor); sourceType="actual"; } }
      else if (method === "percentage") { amount=Math.round(amount*(1+(input.adjustmentPercent??0)/100)); sourceType="percentage"; }
      else if (method === "run_rate") {
        if (line.period <= asOf) { amount=Number(line.actualMinor); sourceType="actual"; }
        else { const avg=averages.get(dimensionKey(line)); amount=avg?.count?Math.round(avg.sum/avg.count):amount; sourceType="run_rate"; }
      }
      return { ...line, amountMinor: amount, source: sourceType };
    });
  }

  const client = await runtime.db.connect();
  const id = createId("fcst");
  try {
    await client.query("BEGIN");
    const prior = await client.query<{ version: number }>(`SELECT COALESCE(MAX(version),0)::int AS version FROM budget_forecasts WHERE organization_id=$1 AND budget_id=$2 AND scenario=$3`, [organizationId,budgetId,input.scenario??"base"]);
    const version=(prior.rows[0]?.version??0)+1;
    await client.query(
      `INSERT INTO budget_forecasts(id,organization_id,budget_id,name,scenario,method,as_of_month,adjustment_percent,status,version,assumptions,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10::jsonb,$11)`,
      [id,organizationId,budgetId,input.name,input.scenario??"base",method,input.asOfMonth??null,input.adjustmentPercent??null,version,JSON.stringify(input.assumptions??{}),actorId],
    );
    for (const line of lines) await client.query(
      `INSERT INTO budget_forecast_lines(id,organization_id,forecast_id,account_id,period,amount_minor,source,cost_center_id,revenue_source_id,project_id,class_id,department_id,location_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [createId("fcl"),organizationId,id,line.accountId,line.period,line.amountMinor,line.source,line.costCenterId??null,line.revenueSourceId??null,line.projectId??null,line.classId??null,line.departmentId??null,line.locationId??null],
    );
    await audit(client, organizationId, actorId, "budget.forecast.created", "budget_forecast", id, { budgetId, method, version, lineCount: lines.length });
    await client.query("COMMIT");
    return { id,budgetId,name:input.name,scenario:input.scenario??"base",method,version,status:"draft" as const,lineCount:lines.length };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function forecastVariance(runtime: Runtime, organizationId: string, forecastId: string) {
  const header=(await runtime.db.query(`SELECT id,budget_id AS "budgetId",name,scenario,method,status,version FROM budget_forecasts WHERE id=$1 AND organization_id=$2`,[forecastId,organizationId])).rows[0];
  if(!header) throw new AppError(404,"NOT_FOUND","Forecast not found");
  const rows=await runtime.db.query(
    `SELECT fl.id AS "forecastLineId",fl.period,a.code AS "accountCode",a.name AS "accountName",a.type AS "accountType",fl.amount_minor::float8 AS "forecastMinor",
      COALESCE(SUM(CASE WHEN a.normal_balance='credit' THEN jl.base_credit_minor-jl.base_debit_minor ELSE jl.base_debit_minor-jl.base_credit_minor END),0)::float8 AS "actualMinor"
     FROM budget_forecast_lines fl JOIN accounts a ON a.id=fl.account_id AND a.organization_id=fl.organization_id
     LEFT JOIN journal_entries j ON j.organization_id=fl.organization_id AND j.status IN ('posted','reversed') AND to_char(j.posting_date,'YYYY-MM')=fl.period
     LEFT JOIN journal_lines jl ON jl.journal_entry_id=j.id AND jl.organization_id=j.organization_id AND jl.account_id=fl.account_id
       AND (fl.project_id IS NULL OR jl.project_id=fl.project_id) AND (fl.class_id IS NULL OR jl.class_id=fl.class_id)
       AND (fl.department_id IS NULL OR jl.department_id=fl.department_id) AND (fl.location_id IS NULL OR jl.location_id=fl.location_id)
       AND (fl.cost_center_id IS NULL OR jl.dimensions_json->>'costCenterId'=fl.cost_center_id)
       AND (fl.revenue_source_id IS NULL OR jl.dimensions_json->>'revenueSourceId'=fl.revenue_source_id)
     WHERE fl.organization_id=$1 AND fl.forecast_id=$2
     GROUP BY fl.id,fl.period,a.code,a.name,a.type,a.normal_balance ORDER BY fl.period,a.code`,[organizationId,forecastId]);
  return { ...header, lines: rows.rows.map((row)=>{const forecast=Number(row.forecastMinor),actual=Number(row.actualMinor),variance=actual-forecast;return{...row,varianceMinor:variance,variancePercent:forecast?(variance/forecast)*100:null};}) };
}

export async function checkBudget(runtime: Runtime, organizationId: string, budgetId: string, input: BudgetLineInput) {
  await refreshBudgetActuals(runtime, organizationId, budgetId);
  const budget=(await runtime.db.query<{ enforcement:string }>("SELECT enforcement FROM budgets WHERE id=$1 AND organization_id=$2",[budgetId,organizationId])).rows[0];
  if(!budget) throw new AppError(404,"NOT_FOUND","Budget not found");
  const result=await runtime.db.query<{ budgetMinor:number; actualMinor:number }>(
    `SELECT COALESCE(SUM(bl.amount_minor),0)::float8 AS "budgetMinor",COALESCE(SUM(ba.actual_minor),0)::float8 AS "actualMinor"
     FROM budget_lines bl LEFT JOIN budget_actuals ba ON ba.budget_line_id=bl.id
     WHERE bl.organization_id=$1 AND bl.budget_id=$2 AND bl.account_id=$3 AND bl.period=$4
       AND bl.cost_center_id IS NOT DISTINCT FROM $5::text AND bl.revenue_source_id IS NOT DISTINCT FROM $6::text
       AND bl.project_id IS NOT DISTINCT FROM $7::text AND bl.class_id IS NOT DISTINCT FROM $8::text
       AND bl.department_id IS NOT DISTINCT FROM $9::text AND bl.location_id IS NOT DISTINCT FROM $10::text`,
    [organizationId,budgetId,input.accountId,input.period,input.costCenterId??null,input.revenueSourceId??null,input.projectId??null,input.classId??null,input.departmentId??null,input.locationId??null],
  );
  const planned=Number(result.rows[0]?.budgetMinor??0),actual=Number(result.rows[0]?.actualMinor??0),projected=actual+input.amountMinor,remaining=planned-projected,exceeded=projected>planned;
  const action=!exceeded||budget.enforcement==="none"?"allow":budget.enforcement==="block"?"block":"warn";
  return { budgetId,period:input.period,accountId:input.accountId,enforcement:budget.enforcement,budgetMinor:planned,actualMinor:actual,proposedMinor:input.amountMinor,projectedMinor:projected,remainingMinor:remaining,exceeded,action };
}
