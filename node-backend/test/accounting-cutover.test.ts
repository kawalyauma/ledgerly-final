import {describe,it,expect,vi} from 'vitest';
import {accountingReportDefaults,generateReport} from '../src/features/reports/service.js';
import {accountingFilters} from '../src/features/finance-core/reporting-period.js';
import type {Pool} from 'pg';

describe('accounting cutover reports',()=>{
 it('scopes the default to the requested organization',async()=>{
  const query=vi.fn().mockResolvedValue({rows:[{startDate:'2026-09-01'}]});
  expect(await accountingReportDefaults({query} as unknown as Pool,'school-a')).toEqual({from:'2026-09-01'});
  expect(query.mock.calls[0][1]).toEqual(['school-a']);
 });
 it('uses term activity for profit and loss',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{startDate:'2026-09-01'}]}).mockResolvedValueOnce({rows:[]});
  const report=await generateReport({db:{query} as unknown as Pool},'school-a','profit-loss',{});
  expect(report.filters.from).toBe('2026-09-01');expect(query.mock.calls[1][1][1]).toBe('2026-09-01');
 });
 it('retains opening balances without historical gross turnover',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{startDate:'2026-09-01'}]}).mockResolvedValueOnce({rows:[{accountId:'ar',code:'1110',name:'Receivable',type:'asset',debitMinor:900,creditMinor:500,netDebitMinor:400},{accountId:'equity',code:'3900',name:'Equity',type:'equity',debitMinor:0,creditMinor:400,netDebitMinor:-400}]});
  const report=await generateReport({db:{query} as unknown as Pool},'school-a','trial-balance',{from:'2026-09-01',to:'2026-09-30'});
  expect(query.mock.calls[1][1][1]).toBe('0001-01-01');expect(report.totals).toEqual({debitMinor:400,creditMinor:400});
 });
 it('keeps explicit historical reporting available',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{startDate:'2026-09-01'}]}).mockResolvedValueOnce({rows:[]});
  const report=await generateReport({db:{query} as unknown as Pool},'school-a','profit-loss',{from:'2026-06-01',to:'2026-08-30'});
  expect(report.filters.from).toBe('2026-06-01');expect(query.mock.calls[1][1][1]).toBe('2026-06-01');
 });
 it('clamps current saved filters to the start but preserves narrower periods',()=>{
  expect(accountingFilters({from:'2026-01-01',to:'2026-10-15'},'2026-09-01')).toEqual({from:'2026-09-01',to:'2026-10-15'});
  expect(accountingFilters({from:'2026-10-01',to:'2026-10-15'},'2026-09-01').from).toBe('2026-10-01');
 });
 it('leaves organizations without a cutover unchanged',()=>{
  expect(accountingFilters({from:'2026-01-01',to:'2026-10-15'})).toEqual({from:'2026-01-01',to:'2026-10-15'});
 });
 it('keeps all customer statement history available',async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});
  const report=await generateReport({db:{query} as unknown as Pool},'school-a','customer-statement',{});
  expect(report.filters.from).toBeUndefined();expect(query.mock.calls).toHaveLength(1);
  expect(query.mock.calls[0][1][3]).toBe('0001-01-01');
 });
 it('uses ledger balances for cutover receivables, including student credits',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{startDate:'2026-09-01'}]}).mockResolvedValueOnce({rows:[
   {contactId:'student',code:'S1',contact:'Student One',type:'customer',openingDate:'2026-09-01',receivableMinor:400,payableMinor:0},
   {contactId:'credit',code:'S2',contact:'Student Credit',type:'customer',openingDate:'2026-09-01',receivableMinor:-100,payableMinor:0}
  ]});
  const report=await generateReport({db:{query} as unknown as Pool},'school-a','receivables-ageing',{asOf:'2026-10-15'});
  expect(report.totals?.outstandingMinor).toBe(300);expect(report.rows[0]?.bucket).toBe('31-60');expect(report.rows[1]?.bucket).toBe('current');
 });
});
