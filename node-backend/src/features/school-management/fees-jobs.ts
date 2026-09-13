import type { ClaimedJob } from "../../queue/postgres-queue.js";
import type { Runtime } from "../../runtime.js";

export async function sweepSchoolFeeInstallments(_job:ClaimedJob,runtime:Runtime){
  await runtime.db.query(`UPDATE school_fee_installments i SET status='overdue',updated_at=CURRENT_TIMESTAMP FROM school_fee_installment_plans p WHERE p.id=i.plan_id AND p.organization_id=i.organization_id AND p.status='active' AND i.status IN ('pending','partially_paid') AND i.paid_minor<i.amount_minor AND i.due_date<CURRENT_DATE`);
  await runtime.db.query(`UPDATE school_fee_installments i SET status=CASE WHEN i.paid_minor>=i.amount_minor THEN 'paid' WHEN i.paid_minor>0 THEN 'partially_paid' ELSE 'pending' END,updated_at=CURRENT_TIMESTAMP FROM school_fee_installment_plans p WHERE p.id=i.plan_id AND p.organization_id=i.organization_id AND p.status='active' AND i.status='overdue' AND i.due_date>=CURRENT_DATE`);
  await runtime.db.query(`UPDATE school_fee_installment_plans p SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE p.status='active' AND NOT EXISTS(SELECT 1 FROM school_fee_installments i WHERE i.organization_id=p.organization_id AND i.plan_id=p.id AND i.status<>'paid')`);
}
