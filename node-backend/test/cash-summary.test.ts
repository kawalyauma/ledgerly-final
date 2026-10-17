import {describe,it,expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {cashSummary} from '../src/features/finance-core/cash-summary.js';
import {generateReport} from '../src/features/reports/service.js';

describe('cash collections clarity',()=>{
 it('totals actual cash days rather than billed revenue',async()=>{
  const query=vi.fn().mockResolvedValue({rows:[{date:'2026-09-01',receivedMinor:600,paidOutMinor:200,feesCollectedMinor:500,feeRefundsMinor:0,otherReceiptsMinor:100},{date:'2026-09-02',receivedMinor:50,paidOutMinor:25,feesCollectedMinor:50,feeRefundsMinor:25,otherReceiptsMinor:0}]});
  const x=await cashSummary({query} as unknown as Pool,'school','2026-09-01','2026-10-15');
  expect(x.receivedMinor).toBe(650);expect(x.paidOutMinor).toBe(225);expect(x.netCashMovementMinor).toBe(425);expect(x.feesCollectedMinor).toBe(550);expect(x.feeRefundsMinor).toBe(25);
  expect(query.mock.calls[0][1]).toEqual(['school','2026-09-01','2026-10-15']);
 });
 it('marks profit and loss as including unpaid fees and non-cash expenses',async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});
  const r=await generateReport({db:{query} as unknown as Pool},'school','profit-loss',{});
  expect(r.basis).toBe('accrual');expect(r.description).toContain('unpaid');
 });
 it('provides a separate cash report using the accounting start',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{startDate:'2026-09-01'}]}).mockResolvedValueOnce({rows:[]});
  const r=await generateReport({db:{query} as unknown as Pool},'school','cash-collections',{});
  expect(r.basis).toBe('cash');expect(r.filters.from).toBe('2026-09-01');expect(r.totals?.receivedMinor).toBe(0);expect(r.description).toContain('transfers');
 });
 it('does not silently ignore cash report drill-down filters',async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});
  await expect(generateReport({db:{query} as unknown as Pool},'school','cash-collections',{accountId:'ar'})).rejects.toMatchObject({code:'CASH_REPORT_FILTER'});
 });
});
