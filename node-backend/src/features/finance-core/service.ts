import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";

type Db = Pool | PoolClient;

export const defaultAccounts = [
  ["1000","Cash and Bank","asset","cash","debit"],
  ["1100","Accounts Receivable","asset","receivable","debit"],
  ["1200","Inventory","asset","inventory","debit"],
  ["2000","Accounts Payable","liability","payable","credit"],
  ["2100","Tax Payable","liability","tax","credit"],
  ["2200","Payroll Payable","liability","payroll","credit"],
  ["3000","Owner's Equity","equity","equity","credit"],
  ["4000","Sales Revenue","revenue","sales","credit"],
  ["5000","Cost of Goods Sold","expense","cogs","debit"],
  ["6000","Operating Expenses","expense","operating","debit"],
  ["6100","Payroll Expense","expense","payroll","debit"],
] as const;

async function audit(db:Db, organizationId:string, actorId:string, action:string, entityType:string, entityId:string, after?:unknown) {
  await db.query(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`, [createId("aud"),organizationId,actorId,action,entityType,entityId,after===undefined?null:JSON.stringify(after)]);
}

export async function ensureFinanceProvisioned(runtime:Runtime, organizationId:string):Promise<void> {
  const ready = await runtime.db.query("SELECT 1 FROM finance_tenant_provisioning WHERE organization_id=$1 AND status='completed'",[organizationId]);
  if (ready.rowCount) return;
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",[`finance:${organizationId}`]);
    const organization = (await client.query<{baseCurrency:string}>(`SELECT base_currency AS "baseCurrency" FROM organizations WHERE id=$1`,[organizationId])).rows[0];
    if (!organization) throw new AppError(404,"ORGANIZATION_NOT_FOUND","Organization not found");
    for (const [code,name,type,subtype,normalBalance] of defaultAccounts) {
      await client.query(`INSERT INTO accounts(id,organization_id,code,name,type,subtype,normal_balance,currency)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (organization_id,code) DO NOTHING`,[createId("acc"),organizationId,code,name,type,subtype,normalBalance,organization.baseCurrency]);
    }
    await client.query(`INSERT INTO finance_tenant_provisioning(organization_id,schema_version,status,provisioned_at,updated_at)
      VALUES($1,1,'completed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT (organization_id) DO UPDATE SET schema_version=EXCLUDED.schema_version,status='completed',last_error=NULL,
        provisioned_at=COALESCE(finance_tenant_provisioning.provisioned_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP`,[organizationId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function provisionPendingOrganizations(runtime:Runtime):Promise<number> {
  const rows = await runtime.db.query<{id:string}>(`SELECT o.id FROM organizations o
    LEFT JOIN finance_tenant_provisioning p ON p.organization_id=o.id AND p.status='completed'
    WHERE o.status='active' AND p.organization_id IS NULL ORDER BY o.created_at LIMIT 100`);
  let provisioned=0;
  for (const row of rows.rows) { await ensureFinanceProvisioned(runtime,row.id); provisioned+=1; }
  await runtime.db.query(`INSERT INTO finance_event_consumptions(event_id,consumer)
    SELECT e.id,'finance-core' FROM backend_outbox_events e
    JOIN finance_tenant_provisioning p ON p.organization_id=e.aggregate_id AND p.status='completed'
    WHERE e.topic='organization.created'
    ON CONFLICT (event_id,consumer) DO NOTHING`);
  return provisioned;
}

export type JournalLineInput = {
  accountId:string; description?:string; debitMinor?:number; creditMinor?:number; contactId?:string; projectId?:string;
  classId?:string; departmentId?:string; locationId?:string; taxCode?:string; dimensions?:Record<string,string|number|boolean|null|undefined>;
};
export type CreateJournalInput = {
  transactionDate:string; postingDate:string; description:string; reference?:string; currency:string; exchangeRateMicros?:number;
  sourceType?:string; sourceId?:string; lines:JournalLineInput[];
};

export function validateJournal(input:CreateJournalInput):void {
  if (input.lines.length<2) throw new AppError(422,"INVALID_JOURNAL","A journal requires at least two lines");
  let debit=0,credit=0;
  for (const line of input.lines) {
    const dr=line.debitMinor??0,cr=line.creditMinor??0;
    if (!Number.isSafeInteger(dr)||!Number.isSafeInteger(cr)||dr<0||cr<0||(dr>0)===(cr>0)) throw new AppError(422,"INVALID_JOURNAL_LINE","Each line needs exactly one positive debit or credit in minor currency units");
    debit+=dr; credit+=cr;
  }
  if (!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||debit!==credit) throw new AppError(422,"UNBALANCED_JOURNAL","Total debits must equal total credits",{debitMinor:debit,creditMinor:credit});
}

async function nextEntryNumber(client:PoolClient,organizationId:string):Promise<string> {
  const row=(await client.query<{lastNumber:string}>(`INSERT INTO finance_journal_sequences(organization_id,last_number)
    VALUES($1,1) ON CONFLICT (organization_id) DO UPDATE SET last_number=finance_journal_sequences.last_number+1,updated_at=CURRENT_TIMESTAMP
    RETURNING last_number::text AS "lastNumber"`,[organizationId])).rows[0];
  return `JE-${String(row?.lastNumber??"1").padStart(8,"0")}`;
}

export async function createJournal(runtime:Runtime,organizationId:string,actorId:string,input:CreateJournalInput,idempotencyKey:string):Promise<{id:string;entryNumber:string;status:"draft"|"posted"|"reversed"}> {
  validateJournal(input); await ensureFinanceProvisioned(runtime,organizationId);
  const client=await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const existing=(await client.query<{id:string;entryNumber:string;status:"draft"|"posted"|"reversed"}>(`SELECT id,entry_number AS "entryNumber",status FROM journal_entries WHERE organization_id=$1 AND idempotency_key=$2`,[organizationId,idempotencyKey])).rows[0];
    if (existing) { await client.query("COMMIT"); return existing; }
    const uniqueAccounts=[...new Set(input.lines.map(line=>line.accountId))];
    const accounts=await client.query<{id:string;active:boolean;allowPosting:boolean}>(`SELECT id,active,allow_posting AS "allowPosting" FROM accounts WHERE organization_id=$1 AND id=ANY($2::text[])`,[organizationId,uniqueAccounts]);
    if (accounts.rows.length!==uniqueAccounts.length) throw new AppError(422,"INVALID_ACCOUNT","Every account must belong to the organization");
    if (accounts.rows.some(account=>!account.active||!account.allowPosting)) throw new AppError(422,"ACCOUNT_NOT_POSTABLE","A journal line references an inactive or non-posting account");
    const id=createId("jnl"),entryNumber=await nextEntryNumber(client,organizationId),rate=input.exchangeRateMicros??1_000_000;
    await client.query(`INSERT INTO journal_entries(id,organization_id,entry_number,transaction_date,posting_date,description,reference,source_type,source_id,status,currency,exchange_rate_micros,idempotency_key)
      VALUES($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,'draft',$10,$11,$12)`,[id,organizationId,entryNumber,input.transactionDate,input.postingDate,input.description,input.reference??null,input.sourceType??"manual",input.sourceId??null,input.currency,rate,idempotencyKey]);
    for (const line of input.lines) {
      const debit=line.debitMinor??0,credit=line.creditMinor??0;
      await client.query(`INSERT INTO journal_lines(id,organization_id,journal_entry_id,account_id,description,debit_minor,credit_minor,base_debit_minor,base_credit_minor,contact_id,project_id,class_id,department_id,location_id,tax_code,dimensions_json)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,[createId("jln"),organizationId,id,line.accountId,line.description??null,debit,credit,Math.round(debit*rate/1_000_000),Math.round(credit*rate/1_000_000),line.contactId??null,line.projectId??null,line.classId??null,line.departmentId??null,line.locationId??null,line.taxCode??null,JSON.stringify(line.dimensions??{})]);
    }
    await audit(client,organizationId,actorId,"journal.created","journal_entry",id,{entryNumber});
    await client.query("COMMIT"); return {id,entryNumber,status:"draft"};
  } catch (error) {
    await client.query("ROLLBACK");
    const pgCode=typeof error==="object"&&error!==null&&"code" in error?String((error as {code?:unknown}).code??""):"";
    if (pgCode==="23505") {
      const retry=(await runtime.db.query<{id:string;entryNumber:string;status:"draft"|"posted"|"reversed"}>(`SELECT id,entry_number AS "entryNumber",status FROM journal_entries WHERE organization_id=$1 AND idempotency_key=$2`,[organizationId,idempotencyKey])).rows[0];
      if (retry) return retry;
    }
    throw error;
  } finally { client.release(); }
}

export async function postJournal(runtime:Runtime,organizationId:string,actorId:string,id:string):Promise<void> {
  const client=await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const journal=(await client.query<{status:string}>("SELECT status FROM journal_entries WHERE id=$1 AND organization_id=$2 FOR UPDATE",[id,organizationId])).rows[0];
    if (!journal) throw new AppError(404,"NOT_FOUND","Journal not found");
    if (journal.status!=="draft") throw new AppError(409,"INVALID_STATE","Only draft journals can be posted");
    const totals=(await client.query<{debit:string;credit:string}>(`SELECT COALESCE(SUM(debit_minor),0)::text AS debit,COALESCE(SUM(credit_minor),0)::text AS credit FROM journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`,[organizationId,id])).rows[0];
    if (!totals||BigInt(totals.debit)!==BigInt(totals.credit)||BigInt(totals.debit)<=0n) throw new AppError(422,"UNBALANCED_JOURNAL","Journal is not balanced");
    await client.query("UPDATE journal_entries SET status='posted',posted_at=CURRENT_TIMESTAMP,posted_by=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3 AND status='draft'",[actorId,id,organizationId]);
    await audit(client,organizationId,actorId,"journal.posted","journal_entry",id);
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

const directReversalSources=new Set(["","manual","journal","general_journal","opening_balance"]);
export async function reversalPreview(runtime:Runtime,organizationId:string,journalId:string) {
  const journal=(await runtime.db.query<{id:string;entryNumber:string;description:string;sourceType:string|null;sourceId:string|null;status:string}>(`SELECT id,entry_number AS "entryNumber",description,source_type AS "sourceType",source_id AS "sourceId",status FROM journal_entries WHERE id=$1 AND organization_id=$2`,[journalId,organizationId])).rows[0];
  if (!journal) throw new AppError(404,"NOT_FOUND","Journal not found");
  const blockers:string[]=[];
  if (journal.status!=="posted") blockers.push(`The journal is ${journal.status}; only posted journals can be reversed.`);
  const source=String(journal.sourceType??"");
  let mode:"journal"|"unsupported"="journal";
  if (!directReversalSources.has(source)) { mode="unsupported"; blockers.push(`This entry was created by “${source}”. Reverse the source transaction instead of only the accounting journal.`); }
  return {journal,impacts:[{type:"journal",id:journal.id,label:`Journal ${journal.entryNumber} · ${journal.description}`,status:journal.status,action:"Create an equal-and-opposite reversal journal and mark the original reversed"}],blockers,mode};
}

export async function reverseJournal(runtime:Runtime,organizationId:string,actorId:string,id:string,postingDate:string,reason:string) {
  const preview=await reversalPreview(runtime,organizationId,id);
  if (preview.blockers.length) throw new AppError(409,"REVERSAL_BLOCKED",preview.blockers.join(" "),{preview});
  const original=(await runtime.db.query<{entryNumber:string;currency:string;exchangeRateMicros:number}>(`SELECT entry_number AS "entryNumber",currency,exchange_rate_micros::float8 AS "exchangeRateMicros" FROM journal_entries WHERE id=$1 AND organization_id=$2`,[id,organizationId])).rows[0]!;
  const raw=await runtime.db.query<{accountId:string;description?:string;debitMinor:number;creditMinor:number;contactId?:string;projectId?:string;classId?:string;departmentId?:string;locationId?:string;taxCode?:string;dimensions:Record<string,unknown>}>(`SELECT account_id AS "accountId",description,debit_minor::float8 AS "debitMinor",credit_minor::float8 AS "creditMinor",contact_id AS "contactId",project_id AS "projectId",class_id AS "classId",department_id AS "departmentId",location_id AS "locationId",tax_code AS "taxCode",dimensions_json AS dimensions FROM journal_lines WHERE journal_entry_id=$1 AND organization_id=$2 ORDER BY id`,[id,organizationId]);
  const reversal=await createJournal(runtime,organizationId,actorId,{transactionDate:postingDate,postingDate,description:`Reversal of ${original.entryNumber}: ${reason}`,reference:original.entryNumber,currency:original.currency,exchangeRateMicros:original.exchangeRateMicros,sourceType:"reversal",sourceId:id,lines:raw.rows.map(line=>({...line,dimensions:line.dimensions as Record<string,string|number|boolean|null|undefined>,debitMinor:line.creditMinor,creditMinor:line.debitMinor}))},`journal:${id}:reversal`);
  await runtime.db.query("UPDATE journal_entries SET reversal_of_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3 AND reversal_of_id IS NULL",[id,reversal.id,organizationId]);
  if (reversal.status==="draft") await postJournal(runtime,organizationId,actorId,reversal.id);
  const result=await runtime.db.query("UPDATE journal_entries SET status='reversed',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status='posted'",[id,organizationId]);
  if (!result.rowCount) {
    const current=(await runtime.db.query<{status:string}>("SELECT status FROM journal_entries WHERE id=$1 AND organization_id=$2",[id,organizationId])).rows[0];
    if (current?.status!=="reversed") throw new AppError(409,"ALREADY_REVERSED","Journal was reversed by another request");
  }
  await audit(runtime.db,organizationId,actorId,"journal.reversed","journal_entry",id,{reversalId:reversal.id,reason});
  return {originalId:id,status:"reversed",reversal:{id:reversal.id,entryNumber:reversal.entryNumber},source:{type:"journal",id,status:"reversed"},preview};
}
