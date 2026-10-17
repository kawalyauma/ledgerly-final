import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";

// School fee control account mapped in school_profiles.system_preferences.feeAccounting.
// Falls back to undefined so document posting can still auto-select a sole receivable account.
export async function schoolFeeControlAccountId(runtime:Runtime,organizationId:string,requested?:string|null){
  if(requested)return requested;
  const row=(await runtime.db.query<{id:string}>(`SELECT a.id FROM school_profiles sp JOIN accounts a ON a.organization_id=sp.organization_id AND a.id=sp.system_preferences->'feeAccounting'->>'receivableAccountId' WHERE sp.organization_id=$1 AND a.active=true AND a.allow_posting=true AND a.subtype='receivable' LIMIT 1`,[organizationId])).rows[0];
  return row?.id;
}

export async function requireSchoolFeeControlAccountId(runtime:Runtime,organizationId:string,requested?:string|null){
  const id=await schoolFeeControlAccountId(runtime,organizationId,requested);
  if(!id)throw new AppError(422,'CONTROL_ACCOUNT_REQUIRED','No school fees receivable account is mapped; supply controlAccountId');
  return id;
}
