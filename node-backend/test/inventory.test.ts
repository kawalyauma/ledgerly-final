import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRuntime, type Runtime } from "../src/runtime.js";
import { generateInventoryValuationReport, recordMovement, reserveStock, reverseMovement, transferStock } from "../src/features/inventory/service.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("inventory, stock, COGS and valuation", () => {
  let runtime: Runtime;
  const org = "org_inventory_test";
  beforeAll(async () => {
    runtime = await createRuntime();
    await runtime.db.query("TRUNCATE backend_outbox_events,audit_logs,users,organizations CASCADE");
    await runtime.db.query(`INSERT INTO organizations(id,name,base_currency,status) VALUES($1,'Inventory Test','UGX','active')`,[org]);
    const accounts = [
      ["acc_inv","1210","Stock Inventory","asset","inventory","debit"],
      ["acc_cogs","5010","Cost of Goods Sold","expense","cogs","debit"],
      ["acc_clear","2050","Goods Received Clearing","liability","payable","credit"],
      ["acc_sales","4010","Product Sales","revenue","sales","credit"],
    ];
    for (const row of accounts) await runtime.db.query(`INSERT INTO accounts(id,organization_id,code,name,type,subtype,normal_balance) VALUES($1,$2,$3,$4,$5,$6,$7)`,[row[0],org,...row.slice(1)]);
    await runtime.db.query(`INSERT INTO inventory_locations(id,organization_id,code,name,is_default) VALUES('loc_main',$1,'MAIN','Main Store',true),('loc_branch',$1,'BR','Branch Store',false)`,[org]);
    await runtime.db.query(`INSERT INTO products(id,organization_id,sku,name,type,income_account_id,expense_account_id,inventory_account_id,reorder_point_micros)
      VALUES('prd_1',$1,'SKU-001','Widget','inventory','acc_sales','acc_cogs','acc_inv',2000000)`,[org]);
  });
  afterAll(async()=>{await runtime?.close();});

  it("uses weighted-average cost and posts COGS for stock issues", async () => {
    const receipt = await recordMovement(runtime,org,"tester",{productId:"prd_1",locationId:"loc_main",type:"receipt",movementDate:"2026-09-01",quantityDeltaMicros:10_000_000,unitCostMinor:500,offsetAccountId:"acc_clear"},"inv-receipt-1");
    expect(receipt).toMatchObject({status:"posted",inventoryValueMinor:5000,quantityOnHandMicros:10_000_000});
    const issue = await recordMovement(runtime,org,"tester",{productId:"prd_1",locationId:"loc_main",type:"issue",movementDate:"2026-09-02",quantityDeltaMicros:-2_000_000},"inv-issue-1");
    expect(issue).toMatchObject({status:"posted",unitCostMinor:500,valueDeltaMinor:-1000,inventoryValueMinor:4000,quantityOnHandMicros:8_000_000});
    const journal = await runtime.db.query(`SELECT a.code,l.debit_minor::float8 AS debit,l.credit_minor::float8 AS credit FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_entry_id=$1 ORDER BY a.code`,[issue.journalEntryId]);
    expect(journal.rows).toEqual([{code:"1210",debit:0,credit:1000},{code:"5010",debit:1000,credit:0}]);
  });

  it("transfers stock without changing total valuation and protects reservations", async () => {
    const transfer = await transferStock(runtime,org,"tester",{productId:"prd_1",fromLocationId:"loc_main",toLocationId:"loc_branch",movementDate:"2026-09-03",quantityMicros:3_000_000},"xfer-1");
    expect(transfer.valueMinor).toBe(1500);
    const reservation = await reserveStock(runtime,org,"tester",{productId:"prd_1",locationId:"loc_branch",quantityMicros:2_000_000,sourceType:"sales_order",sourceId:"so-1"});
    expect(reservation.status).toBe("active");
    await expect(recordMovement(runtime,org,"tester",{productId:"prd_1",locationId:"loc_branch",type:"issue",movementDate:"2026-09-04",quantityDeltaMicros:-2_000_000},"reserved-issue")).rejects.toMatchObject({code:"NEGATIVE_STOCK"});
    const balances=await runtime.db.query(`SELECT SUM(quantity_micros)::float8 AS qty,SUM(inventory_value_minor)::float8 AS value FROM inventory_balances WHERE organization_id=$1 AND product_id='prd_1'`,[org]);
    expect(balances.rows[0]).toMatchObject({qty:8_000_000,value:4000});
  });

  it("produces historical inventory valuation and exact-cost reversals", async () => {
    const valuation=await generateInventoryValuationReport(runtime,org,{asOf:"2026-09-03"});
    expect(valuation.totals).toMatchObject({quantityMicros:8_000_000,inventoryValueMinor:4000});
    const original=(await runtime.db.query<{id:string}>(`SELECT id FROM inventory_movements WHERE organization_id=$1 AND idempotency_key='inv-issue-1'`,[org])).rows[0]!;
    const reversal=await reverseMovement(runtime,org,"tester",original.id,"2026-09-05","Customer order cancelled");
    expect(reversal.status).toBe("reversed");
    const total=await runtime.db.query(`SELECT quantity_on_hand_micros::float8 AS qty,average_cost_minor::float8 AS cost FROM products WHERE id='prd_1' AND organization_id=$1`,[org]);
    expect(total.rows[0]).toMatchObject({qty:10_000_000,cost:500});
  });
});
