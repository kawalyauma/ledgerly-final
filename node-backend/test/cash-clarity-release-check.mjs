import assert from 'node:assert/strict';import{createRequire}from'node:module';
const require=createRequire('/app/package.json'),{Client}=require('pg');
const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
const root=process.env.REPORT_BUILD_ROOT||'/app/dist';
const {cashSummary}=await import(`${root}/features/finance-core/cash-summary.js`);
const {generateReport}=await import(`${root}/features/reports/service.js`);
const {renderReport}=await import(`${root}/features/reports/render.js`);
const {workspaceSettingsFeature}=await import(`${root}/features/workspace-settings/index.js`);
const {createDashboardRoutes}=await import(`${root}/features/report-management/routes.js`);
const {Hono}=require('hono');
try{
 await db.query('BEGIN READ ONLY');
 const fixture=`WITH accounts(id,organization_id,type,subtype) AS (VALUES ('cash','test','asset','cash'),('bank','test','asset','clearing'),('ar','test','asset','receivable'),('revenue','test','revenue','fees'),('expense','test','expense','fee_concessions')),
 bank_accounts(organization_id,ledger_account_id) AS (VALUES ('test','bank')),
 journal_entries(id,organization_id,posting_date,status,source_type,reversal_of_id) AS (VALUES
 ('opening','test','2026-09-01'::date,'posted','opening_balance',NULL::text),('invoice','test','2026-09-01'::date,'posted','invoice',NULL),
 ('receipt','test','2026-09-01'::date,'reversed','receipt',NULL),('transfer','test','2026-09-01'::date,'posted','bank_transfer',NULL),
 ('concession','test','2026-09-01'::date,'posted','school_fee_bursary_recognition',NULL),('payment','test','2026-09-01'::date,'posted','payment',NULL),
 ('refund','test','2026-09-02'::date,'posted','reversal','receipt'),('capital','test','2026-09-02'::date,'posted','capital',NULL)),
 journal_lines(journal_entry_id,organization_id,account_id,base_debit_minor,base_credit_minor) AS (VALUES
 ('opening','test','cash',100,0),('invoice','test','ar',10000,0),('invoice','test','revenue',0,10000),
 ('receipt','test','cash',600,0),('transfer','test','cash',0,400),('transfer','test','bank',400,0),
 ('concession','test','expense',3377,0),('concession','test','revenue',0,3377),('payment','test','cash',0,200),
 ('refund','test','cash',0,100),('capital','test','cash',250,0)), cash_entries`;
 const synthetic=await cashSummary({query:(sql,args)=>db.query(sql.replace('WITH cash_entries',fixture),args)},'test','2026-09-01','2026-10-16');
 assert.equal(synthetic.receivedMinor,850);assert.equal(synthetic.paidOutMinor,300);assert.equal(synthetic.feesCollectedMinor,600);assert.equal(synthetic.feeRefundsMinor,100);assert.equal(synthetic.otherReceiptsMinor,250);assert.equal(synthetic.netCashMovementMinor,550);
 const org='org_056e6a51a5e34628b3874570ed0494e9',user='usr_3996251b0cc140718bdaf629002975eb',runtime={db};
 const cash=await generateReport(runtime,org,'cash-collections',{}),pl=await generateReport(runtime,org,'profit-loss',{});
 assert.equal(cash.basis,'cash');assert.equal(pl.basis,'accrual');assert.ok(pl.description.includes('unpaid'));
 const app=new Hono();app.use('*',async(c,next)=>{c.set('principal',{organizationId:org,userId:user,role:'viewer',scopes:['reports:read','school:read']});await next()});workspaceSettingsFeature.mount(app,runtime);app.route('/dashboards',createDashboardRoutes(runtime));
 const ov=(await(await app.request('/api/v1/workspace/overview')).json()).data;
 const dash=(await(await app.request('/dashboards/summary')).json()).data;
 assert.equal(ov.finance.receivedMinor,cash.totals.receivedMinor);assert.equal(ov.finance.paidOutMinor,cash.totals.paidOutMinor);assert.equal(dash.metrics.moneyInMinor,cash.totals.receivedMinor);assert.equal(dash.metrics.moneyOutMinor,cash.totals.paidOutMinor);
 for(const report of [cash,pl])for(const format of ['json','csv','xlsx','pdf'])assert.ok((await renderReport(report,format,'Ledgerly Verification')).byteLength>0);
 const protectedRecords=(await db.query(`SELECT count(*)::int count,md5(string_agg(to_jsonb(l)::text,'' ORDER BY l.id)) fingerprint FROM journal_lines l WHERE l.organization_id=$1 AND l.dimensions_json ? 'schoolStudentId'`,[org])).rows[0];
 console.log(JSON.stringify({status:'PASS',checked:'SQL: unpaid invoices, noncash concessions, internal transfers and opening entries excluded; reversals classified; live dashboard/report parity; eight export renderings',from:cash.filters.from,to:cash.filters.to,cash:cash.totals,accrual:pl.totals,concessionsMinor:ov.finance.concessionsMinor,protectedRecords},null,2));
 await db.query('ROLLBACK');
}finally{await db.end()}
