import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";

/**
 * The receivable account school fees post to when a request doesn't name one.
 * Schools often have both "Accounts Receivable" and "School Fees Receivable"; fees belong on
 * the fee account (SchoolPay, write-offs and bursaries already use it), so prefer an account of
 * the school_fee_receivable subtype, then a receivable account with "fee" in its name, then the
 * school's only receivable account. `invoice` restricts to the "receivable" subtype because
 * invoice posting only accepts that subtype as a control account.
 */
export async function feeReceivableAccountId(runtime: Runtime, organizationId: string, use: "invoice" | "receipt"): Promise<string> {
  const subtypes = use === "invoice" ? ["receivable"] : ["school_fee_receivable", "receivable"];
  const rows = (await runtime.db.query<{ id: string; subtype: string; name: string }>(
    `SELECT id,subtype,name FROM accounts WHERE organization_id=$1 AND active AND allow_posting AND subtype=ANY($2::text[])
     ORDER BY (subtype='school_fee_receivable') DESC, (name ILIKE '%fee%') DESC, code`,
    [organizationId, subtypes],
  )).rows;
  const preferred = rows.find(r => r.subtype === "school_fee_receivable") ?? rows.find(r => /fee/i.test(r.name)) ?? (rows.length === 1 ? rows[0] : undefined);
  if (!preferred) {
    throw new AppError(422, "FEE_ACCOUNTS_NOT_SET_UP", rows.length
      ? "This school has several receivable accounts. Rename the one used for fees to include \"School Fees\" (e.g. School Fees Receivable) in the chart of accounts."
      : "This school has no fees receivable account yet. Add a \"School Fees Receivable\" account in the chart of accounts.");
  }
  return preferred.id;
}
