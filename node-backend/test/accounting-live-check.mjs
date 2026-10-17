import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const require=createRequire('/app/package.json'),{Client}=require('pg');
const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
const root=process.env.REPORT_BUILD_ROOT||'/app/dist';
const {generateReport,reportCatalog}=await import(`${root}/features/reports/service.js`);
const {createDashboardRoutes}=await import(`${root}/features/report-management/routes.js`);
const {workspaceSettingsFeature}=await import(`${root}/features/workspace-settings/index.js`);
const {Hono}=require('hono');
const org='org_056e6a51a5e34628b3874570ed0494e9',user='usr_3996251b0cc140718bdaf629002975eb';
try{
 await db.query('BEGIN READ ONLY');
 const today=new Date().toISOString().slice(0,10),runtime={db};
 const reports={};for(const r of reportCatalog.filter(r=>r.available))reports[r.id]=await generateReport(runtime,org,r.id,{to:today});
 assert.equal(reports['profit-loss'].filters.from,'2026-09-01');assert.equal(reports['balance-sheet'].totals.differenceMinor,0);
 const trial=reports['trial-balance'];assert.equal(trial.totals.debitMinor,trial.totals.creditMinor);
 const cash=reports['cash-bank-summary'].totals.ledgerBalanceMinor;
 const opening=await generateReport(runtime,org,'balance-sheet',{asOf:'2026-08-31'});
 assert.equal(opening.rows.filter(r=>r.subtype==='cash'||r.subtype==='bank').reduce((n,r)=>n+Number(r.amountMinor),0),0);
 assert.equal(opening.totals.assetMinor,419188900);assert.equal(opening.totals.equityMinor,419188900);
 const receivables=reports['receivables-ageing'].totals.outstandingMinor;
 const arLedger=Number((await db.query(`SELECT COALESCE(SUM(l.base_debit_minor-l.base_credit_minor),0)::float8 amount FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=$1 AND j.status IN ('posted','reversed') AND j.posting_date <= $2::date AND a.type='asset' AND a.subtype IN ('receivable','school_fee_receivable')`,[org,today])).rows[0].amount);
 assert.equal(receivables,arLedger);
 const app=new Hono();app.use('*',async(c,next)=>{c.set('principal',{organizationId:org,userId:user,role:'viewer',scopes:['reports:read','school:read']});await next()});app.route('/dashboards',createDashboardRoutes(runtime));workspaceSettingsFeature.mount(app,runtime);
 const summary=(await (await app.request('/dashboards/summary')).json()).data;
 const overview=(await (await app.request('/api/v1/workspace/overview')).json()).data;
 assert.equal(summary.metrics.balanceMinor,cash);assert.equal(overview.finance.cashMinor,cash);assert.equal(summary.metrics.outstandingMinor,receivables);
 assert.equal(overview.finance.revenueMinor,reports['profit-loss'].totals.revenueMinor);assert.equal(overview.finance.expensesMinor,reports['profit-loss'].totals.expenseMinor);
 assert.ok(summary.cashFlow.every(r=>r.month>='2026-09'));assert.deepEqual(overview.monthly.map(r=>r.label),['Sep 2026','Oct 2026']);
 const learnerHistory=(await db.query(`SELECT COUNT(*)::int count,md5(string_agg(to_jsonb(l)::text,'' ORDER BY l.id)) fingerprint FROM journal_lines l WHERE l.organization_id=$1 AND l.dimensions_json ? 'schoolStudentId'`,[org])).rows[0];
 const fees={};
 for(const table of ['school_students','school_fee_assessments','school_fee_receipts','school_fee_allocations']){
  const exists=(await db.query('SELECT to_regclass($1) present',[table])).rows[0].present;if(exists)fees[table]=(await db.query(`SELECT COUNT(*)::int count,md5(string_agg(to_jsonb(t)::text,'' ORDER BY t.id)) fingerprint FROM ${table} t WHERE organization_id=$1`,[org])).rows[0];
 }
 const result={verifiedAt:new Date().toISOString(),reportsChecked:Object.keys(reports).length,from:'2026-09-01',opening:opening.totals,profitLoss:reports['profit-loss'].totals,cashMinor:cash,receivablesMinor:receivables,trial:trial.totals,learnerHistory,fees};
 console.log(JSON.stringify(result,null,2));
 await db.query('ROLLBACK');
 if(process.env.SAVE_READ_TOKEN==='yes'){
  const {SignJWT}=await import('/app/node_modules/jose/dist/webapi/index.js');
  const token=await new SignJWT({org,role:'viewer',scopes:['reports:read','school:read','accounts:read']}).setProtectedHeader({alg:'HS256'}).setSubject(user).setIssuer(process.env.JWT_ISSUER).setAudience(process.env.JWT_AUDIENCE).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  writeFileSync('/tmp/accounting-read-token',token,{mode:0o600});
 }
}finally{await db.end()}
