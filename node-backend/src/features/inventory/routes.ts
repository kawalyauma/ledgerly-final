import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
import {
  changeReservation, completeStockCount, createStockCount, fulfillDocument, generateCogsReport, generateInventoryValuationReport,
  recordMovement, reserveStock, reverseMovement, saveStockCountLines, transferStock,
} from "./service.js";

const productInput = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(160),
  type: z.enum(["inventory","service","non_inventory"]),
  incomeAccountId: z.string().optional(),
  expenseAccountId: z.string().optional(),
  inventoryAccountId: z.string().optional(),
  quantityOnHandMicros: z.number().int().nonnegative().default(0),
  averageCostMinor: z.number().int().nonnegative().default(0),
  reorderPointMicros: z.number().int().nonnegative().default(0),
  salesPriceMinor: z.number().int().nonnegative().default(0),
  purchasePriceMinor: z.number().int().nonnegative().default(0),
  unitOfMeasure: z.string().trim().min(1).max(30).default("each"),
});
const productUpdate = productInput.omit({ quantityOnHandMicros: true, averageCostMinor: true }).partial();
const locationInput = z.object({ code: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(160), isDefault: z.boolean().default(false), active: z.boolean().default(true) });
const movementInput = z.object({
  productId: z.string().min(1), locationId: z.string().min(1),
  type: z.enum(["opening","receipt","issue","adjustment","sale_return","purchase_return"]),
  movementDate: z.iso.date(), quantityDeltaMicros: z.number().int(), unitCostMinor: z.number().int().nonnegative().optional(),
  offsetAccountId: z.string().optional(), sourceType: z.string().max(50).optional(), sourceId: z.string().max(100).optional(),
});
const transferInput = z.object({ productId: z.string(), fromLocationId: z.string(), toLocationId: z.string(), movementDate: z.iso.date(), quantityMicros: z.number().int().positive() });

function pagination(c: { req: { query: (name: string) => string | undefined } }) {
  const rawLimit = Number(c.req.query("limit") ?? 50), rawOffset = Number(c.req.query("offset") ?? 0);
  return { limit: Number.isSafeInteger(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50, offset: Number.isSafeInteger(rawOffset) ? Math.max(0, rawOffset) : 0 };
}

async function validateProductAccounts(runtime: Runtime, organizationId: string, input: { type?: string; incomeAccountId?: string; expenseAccountId?: string; inventoryAccountId?: string }) {
  const rules: Array<[string | undefined,string,string]> = [
    [input.incomeAccountId,"revenue","Income account"], [input.expenseAccountId,"expense","Expense/COGS account"], [input.inventoryAccountId,"asset","Inventory account"],
  ];
  for (const [id, type, label] of rules) {
    if (!id) continue;
    const row = (await runtime.db.query<{ type: string; active: boolean; allowPosting: boolean }>(
      `SELECT type,active,allow_posting AS "allowPosting" FROM accounts WHERE id=$1 AND organization_id=$2`, [id, organizationId],
    )).rows[0];
    if (!row || row.type !== type || !row.active || !row.allowPosting) throw new AppError(422, "INVALID_ACCOUNT", `${label} must be an active postable ${type} account`);
  }
  if (input.type === "inventory" && !input.inventoryAccountId) throw new AppError(422, "INVENTORY_ACCOUNT_REQUIRED", "Inventory products require an inventory asset account");
}

async function createUnpostedOpeningStock(runtime: Runtime, organizationId: string, actorId: string, productId: string, quantity: number, unitCost: number) {
  if (!quantity) return null;
  let location = (await runtime.db.query<{ id: string }>(
    `SELECT id FROM inventory_locations WHERE organization_id=$1 AND active=true ORDER BY is_default DESC,created_at LIMIT 1`, [organizationId],
  )).rows[0];
  if (!location) {
    location = { id: createId("loc") };
    await runtime.db.query(`INSERT INTO inventory_locations(id,organization_id,code,name,is_default) VALUES($1,$2,'MAIN','Main Location',true)`, [location.id, organizationId]);
  }
  const value = Math.round(quantity * unitCost / 1_000_000);
  await runtime.db.query(
    `INSERT INTO inventory_balances(organization_id,product_id,location_id,quantity_micros,inventory_value_minor)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (organization_id,product_id,location_id) DO UPDATE SET quantity_micros=inventory_balances.quantity_micros+EXCLUDED.quantity_micros,
       inventory_value_minor=inventory_balances.inventory_value_minor+EXCLUDED.inventory_value_minor,updated_at=CURRENT_TIMESTAMP`,
    [organizationId, productId, location.id, quantity, value],
  );
  const movementId = createId("mov");
  await runtime.db.query(
    `INSERT INTO inventory_movements(id,organization_id,product_id,location_id,type,movement_date,quantity_delta_micros,unit_cost_minor,value_delta_minor,
      source_type,source_id,idempotency_key,status,created_by)
     VALUES($1,$2,$3,$4,'opening',CURRENT_DATE,$5,$6,$7,'product_creation_unposted',$3,$8,'posted',$9)`,
    [movementId, organizationId, productId, location.id, quantity, unitCost, value, `product-opening:${productId}`, actorId],
  );
  return { locationId: location.id, movementId, accountingPosted: false };
}

export function createProductRoutes(runtime: Runtime) {
  const router = new Hono<AppEnv>();
  router.get("/", requireScope("products:read"), async (c) => {
    const p = c.get("principal"), { limit, offset } = pagination(c), type = c.req.query("type"), q = c.req.query("q");
    const params: unknown[] = [p.organizationId]; const conditions = ["organization_id=$1"];
    if (type) { params.push(type); conditions.push(`type=$${params.length}`); }
    if (q) { params.push(`%${q}%`); conditions.push(`(sku ILIKE $${params.length} OR name ILIKE $${params.length})`); }
    params.push(limit, offset);
    const result = await runtime.db.query(
      `SELECT id,sku,name,type,income_account_id AS "incomeAccountId",expense_account_id AS "expenseAccountId",inventory_account_id AS "inventoryAccountId",
       quantity_on_hand_micros::float8 AS "quantityOnHandMicros",average_cost_minor::float8 AS "averageCostMinor",reorder_point_micros::float8 AS "reorderPointMicros",
       sales_price_minor::float8 AS "salesPriceMinor",purchase_price_minor::float8 AS "purchasePriceMinor",unit_of_measure AS "unitOfMeasure",active
       FROM products WHERE ${conditions.join(" AND ")} ORDER BY name LIMIT $${params.length-1} OFFSET $${params.length}`, params,
    );
    return c.json({ data: result.rows, pagination: { limit, offset } });
  });
  router.post("/", requireScope("products:write"), async (c) => {
    const parsed = productInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid product", parsed.error.flatten());
    const p = c.get("principal"), v = parsed.data;
    if (v.type !== "inventory" && v.quantityOnHandMicros !== 0) throw new AppError(422, "INVALID_QUANTITY", "Only inventory products can have opening stock");
    await validateProductAccounts(runtime, p.organizationId, v);
    const id = createId("prd");
    await runtime.db.query(
      `INSERT INTO products(id,organization_id,sku,name,type,income_account_id,expense_account_id,inventory_account_id,reorder_point_micros,sales_price_minor,purchase_price_minor,unit_of_measure)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id,p.organizationId,v.sku,v.name,v.type,v.incomeAccountId??null,v.expenseAccountId??null,v.inventoryAccountId??null,v.reorderPointMicros,v.salesPriceMinor,v.purchasePriceMinor,v.unitOfMeasure],
    );
    const opening = v.quantityOnHandMicros ? await createUnpostedOpeningStock(runtime,p.organizationId,p.userId,id,v.quantityOnHandMicros,v.averageCostMinor) : null;
    await runtime.db.query(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'product.created','product',$4,$5::jsonb)`,
      [createId("aud"),p.organizationId,p.userId,id,JSON.stringify(v)]);
    return c.json({ data: { id, ...v, openingStock: opening } }, 201);
  });
  router.get("/:id", requireScope("products:read"), async (c) => {
    const p=c.get("principal"), id=c.req.param("id");
    const product=(await runtime.db.query(`SELECT id,sku,name,type,income_account_id AS "incomeAccountId",expense_account_id AS "expenseAccountId",inventory_account_id AS "inventoryAccountId",
      quantity_on_hand_micros::float8 AS "quantityOnHandMicros",average_cost_minor::float8 AS "averageCostMinor",reorder_point_micros::float8 AS "reorderPointMicros",
      sales_price_minor::float8 AS "salesPriceMinor",purchase_price_minor::float8 AS "purchasePriceMinor",unit_of_measure AS "unitOfMeasure",active
      FROM products WHERE id=$1 AND organization_id=$2`,[id,p.organizationId])).rows[0];
    if(!product)throw new AppError(404,"NOT_FOUND","Product not found");
    const balances=await runtime.db.query(`SELECT b.location_id AS "locationId",l.code AS "locationCode",l.name AS location,b.quantity_micros::float8 AS "quantityMicros",
      b.reserved_quantity_micros::float8 AS "reservedMicros",(b.quantity_micros-b.reserved_quantity_micros)::float8 AS "availableMicros",b.inventory_value_minor::float8 AS "inventoryValueMinor"
      FROM inventory_balances b JOIN inventory_locations l ON l.id=b.location_id AND l.organization_id=b.organization_id WHERE b.organization_id=$1 AND b.product_id=$2 ORDER BY l.code`,[p.organizationId,id]);
    return c.json({data:{...product,balances:balances.rows}});
  });
  router.patch("/:id", requireScope("products:write"), async (c) => {
    const parsed=productUpdate.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid product update",parsed.error.flatten());
    const p=c.get("principal"),id=c.req.param("id"),current=(await runtime.db.query<any>(`SELECT sku,name,type,income_account_id AS "incomeAccountId",expense_account_id AS "expenseAccountId",inventory_account_id AS "inventoryAccountId",reorder_point_micros::float8 AS "reorderPointMicros",sales_price_minor::float8 AS "salesPriceMinor",purchase_price_minor::float8 AS "purchasePriceMinor",unit_of_measure AS "unitOfMeasure" FROM products WHERE id=$1 AND organization_id=$2`,[id,p.organizationId])).rows[0];
    if(!current)throw new AppError(404,"NOT_FOUND","Product not found"); const v={...current,...parsed.data}; await validateProductAccounts(runtime,p.organizationId,v);
    await runtime.db.query(`UPDATE products SET sku=$1,name=$2,type=$3,income_account_id=$4,expense_account_id=$5,inventory_account_id=$6,reorder_point_micros=$7,sales_price_minor=$8,purchase_price_minor=$9,unit_of_measure=$10,updated_at=CURRENT_TIMESTAMP WHERE id=$11 AND organization_id=$12`,[v.sku,v.name,v.type,v.incomeAccountId??null,v.expenseAccountId??null,v.inventoryAccountId??null,v.reorderPointMicros,v.salesPriceMinor,v.purchasePriceMinor,v.unitOfMeasure,id,p.organizationId]);
    return c.json({data:{id,...v}});
  });
  router.patch("/:id/active", requireScope("products:write"), async (c) => {
    const parsed=z.object({active:z.boolean()}).safeParse(await c.req.json().catch(()=>null)); if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid status");
    const p=c.get("principal"),id=c.req.param("id"),r=await runtime.db.query(`UPDATE products SET active=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,[parsed.data.active,id,p.organizationId]);
    if(!r.rowCount)throw new AppError(404,"NOT_FOUND","Product not found"); return c.json({data:{id,active:parsed.data.active}});
  });
  router.get("/:id/movements", requireScope("products:read"), async (c) => {
    const p=c.get("principal"),id=c.req.param("id"),{limit,offset}=pagination(c); const r=await runtime.db.query(`SELECT m.id,m.type,m.movement_date::text AS "movementDate",m.quantity_delta_micros::float8 AS "quantityDeltaMicros",m.unit_cost_minor::float8 AS "unitCostMinor",m.value_delta_minor::float8 AS "valueDeltaMinor",m.source_type AS "sourceType",m.source_id AS "sourceId",m.status,l.code AS "locationCode",j.entry_number AS "journalEntryNumber" FROM inventory_movements m JOIN inventory_locations l ON l.id=m.location_id AND l.organization_id=m.organization_id LEFT JOIN journal_entries j ON j.id=m.journal_entry_id AND j.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.product_id=$2 ORDER BY m.movement_date DESC,m.created_at DESC LIMIT $3 OFFSET $4`,[p.organizationId,id,limit,offset]); return c.json({data:r.rows,pagination:{limit,offset}});
  });
  return router;
}

export function createInventoryRoutes(runtime: Runtime) {
  const router=new Hono<AppEnv>();
  router.get("/locations",requireScope("products:read"),async c=>{const p=c.get("principal"),r=await runtime.db.query(`SELECT id,code,name,active,is_default AS "isDefault",metadata FROM inventory_locations WHERE organization_id=$1 ORDER BY is_default DESC,code`,[p.organizationId]);return c.json({data:r.rows});});
  router.post("/locations",requireScope("products:write"),async c=>{const s=locationInput.safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid location",s.error.flatten());const p=c.get("principal"),id=createId("loc"),v=s.data;if(v.isDefault)await runtime.db.query("UPDATE inventory_locations SET is_default=false,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1",[p.organizationId]);await runtime.db.query(`INSERT INTO inventory_locations(id,organization_id,code,name,active,is_default) VALUES($1,$2,$3,$4,$5,$6)`,[id,p.organizationId,v.code,v.name,v.active,v.isDefault]);return c.json({data:{id,...v}},201);});
  router.patch("/locations/:id",requireScope("products:write"),async c=>{const s=locationInput.partial().safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid location",s.error.flatten());const p=c.get("principal"),id=c.req.param("id"),current=(await runtime.db.query<any>(`SELECT code,name,active,is_default AS "isDefault" FROM inventory_locations WHERE id=$1 AND organization_id=$2`,[id,p.organizationId])).rows[0];if(!current)throw new AppError(404,"NOT_FOUND","Location not found");const v={...current,...s.data};if(v.isDefault)await runtime.db.query("UPDATE inventory_locations SET is_default=false,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND id<>$2",[p.organizationId,id]);await runtime.db.query(`UPDATE inventory_locations SET code=$1,name=$2,active=$3,is_default=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$5 AND organization_id=$6`,[v.code,v.name,v.active,v.isDefault,id,p.organizationId]);return c.json({data:{id,...v}});});

  router.get("/balances",requireScope("products:read"),async c=>{const p=c.get("principal"),params:unknown[]=[p.organizationId],conditions=["b.organization_id=$1"];const productId=c.req.query("productId"),locationId=c.req.query("locationId"),lowStock=c.req.query("lowStock")==="true";if(productId){params.push(productId);conditions.push(`b.product_id=$${params.length}`);}if(locationId){params.push(locationId);conditions.push(`b.location_id=$${params.length}`);}if(lowStock)conditions.push("p.reorder_point_micros>0 AND b.quantity_micros-b.reserved_quantity_micros<=p.reorder_point_micros");const r=await runtime.db.query(`SELECT b.product_id AS "productId",p.sku,p.name,b.location_id AS "locationId",l.code AS "locationCode",l.name AS location,b.quantity_micros::float8 AS "quantityMicros",b.reserved_quantity_micros::float8 AS "reservedMicros",(b.quantity_micros-b.reserved_quantity_micros)::float8 AS "availableMicros",b.inventory_value_minor::float8 AS "inventoryValueMinor",p.average_cost_minor::float8 AS "averageCostMinor",p.reorder_point_micros::float8 AS "reorderPointMicros" FROM inventory_balances b JOIN products p ON p.id=b.product_id AND p.organization_id=b.organization_id JOIN inventory_locations l ON l.id=b.location_id AND l.organization_id=b.organization_id WHERE ${conditions.join(" AND ")} ORDER BY p.sku,l.code`,params);return c.json({data:r.rows});});
  router.get("/reorder",requireScope("products:read"),async c=>{const p=c.get("principal"),r=await runtime.db.query(`SELECT p.id AS "productId",p.sku,p.name,p.reorder_point_micros::float8 AS "reorderPointMicros",p.quantity_on_hand_micros::float8 AS "onHandMicros",COALESCE(SUM(b.reserved_quantity_micros),0)::float8 AS "reservedMicros",(p.quantity_on_hand_micros-COALESCE(SUM(b.reserved_quantity_micros),0))::float8 AS "availableMicros" FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id AND b.organization_id=p.organization_id WHERE p.organization_id=$1 AND p.type='inventory' AND p.active=true AND p.reorder_point_micros>0 GROUP BY p.id HAVING p.quantity_on_hand_micros-COALESCE(SUM(b.reserved_quantity_micros),0)<=p.reorder_point_micros ORDER BY p.sku`,[p.organizationId]);return c.json({data:r.rows});});
  router.get("/movements",requireScope("products:read"),async c=>{const p=c.get("principal"),{limit,offset}=pagination(c),params:unknown[]=[p.organizationId],conditions=["m.organization_id=$1"];for(const [query,column] of [["productId","m.product_id"],["locationId","m.location_id"],["type","m.type"],["sourceType","m.source_type"]] as const){const value=c.req.query(query);if(value){params.push(value);conditions.push(`${column}=$${params.length}`);}}const from=c.req.query("from"),to=c.req.query("to");if(from){params.push(from);conditions.push(`m.movement_date>=$${params.length}::date`);}if(to){params.push(to);conditions.push(`m.movement_date<=$${params.length}::date`);}params.push(limit,offset);const r=await runtime.db.query(`SELECT m.id,m.product_id AS "productId",p.sku,p.name AS product,m.location_id AS "locationId",l.code AS "locationCode",m.type,m.movement_date::text AS "movementDate",m.quantity_delta_micros::float8 AS "quantityDeltaMicros",m.unit_cost_minor::float8 AS "unitCostMinor",m.value_delta_minor::float8 AS "valueDeltaMinor",m.source_type AS "sourceType",m.source_id AS "sourceId",m.status,m.journal_entry_id AS "journalEntryId",m.transfer_group_id AS "transferGroupId" FROM inventory_movements m JOIN products p ON p.id=m.product_id AND p.organization_id=m.organization_id JOIN inventory_locations l ON l.id=m.location_id AND l.organization_id=m.organization_id WHERE ${conditions.join(" AND ")} ORDER BY m.movement_date DESC,m.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params);return c.json({data:r.rows,pagination:{limit,offset}});});
  router.post("/movements",requireScope("products:write"),async c=>{const key=c.req.header("Idempotency-Key");if(!key)throw new AppError(422,"IDEMPOTENCY_KEY_REQUIRED","Idempotency-Key is required");const s=movementInput.safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid movement",s.error.flatten());const p=c.get("principal");return c.json({data:await recordMovement(runtime,p.organizationId,p.userId,s.data,key)},201);});
  router.post("/movements/:id/reverse",requireScope("products:write"),async c=>{const s=z.object({reversalDate:z.iso.date(),reason:z.string().trim().min(3).max(500)}).safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid reversal",s.error.flatten());const p=c.get("principal");return c.json({data:await reverseMovement(runtime,p.organizationId,p.userId,c.req.param("id"),s.data.reversalDate,s.data.reason)});});
  router.post("/transfers",requireScope("products:write"),async c=>{const key=c.req.header("Idempotency-Key");if(!key)throw new AppError(422,"IDEMPOTENCY_KEY_REQUIRED","Idempotency-Key is required");const s=transferInput.safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid transfer",s.error.flatten());const p=c.get("principal");return c.json({data:await transferStock(runtime,p.organizationId,p.userId,s.data,key)},201);});

  router.get("/reservations",requireScope("products:read"),async c=>{const p=c.get("principal"),r=await runtime.db.query(`SELECT r.id,r.product_id AS "productId",p.sku,p.name AS product,r.location_id AS "locationId",l.code AS "locationCode",r.quantity_micros::float8 AS "quantityMicros",r.source_type AS "sourceType",r.source_id AS "sourceId",r.status,r.expires_at AS "expiresAt",r.created_at AS "createdAt" FROM inventory_reservations r JOIN products p ON p.id=r.product_id AND p.organization_id=r.organization_id JOIN inventory_locations l ON l.id=r.location_id AND l.organization_id=r.organization_id WHERE r.organization_id=$1 ORDER BY r.created_at DESC`,[p.organizationId]);return c.json({data:r.rows});});
  router.post("/reservations",requireScope("products:write"),async c=>{const s=z.object({productId:z.string(),locationId:z.string(),quantityMicros:z.number().int().positive(),sourceType:z.string().min(1).max(50),sourceId:z.string().min(1).max(100),expiresAt:z.iso.datetime().optional()}).safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid reservation",s.error.flatten());const p=c.get("principal");return c.json({data:await reserveStock(runtime,p.organizationId,p.userId,s.data)},201);});
  router.post("/reservations/:id/release",requireScope("products:write"),async c=>{const p=c.get("principal");return c.json({data:await changeReservation(runtime,p.organizationId,p.userId,c.req.param("id"),"release")});});
  router.post("/reservations/:id/consume",requireScope("products:write"),async c=>{const p=c.get("principal");return c.json({data:await changeReservation(runtime,p.organizationId,p.userId,c.req.param("id"),"consume")});});

  router.get("/stock-counts",requireScope("products:read"),async c=>{const p=c.get("principal"),r=await runtime.db.query(`SELECT s.id,s.count_date::text AS "countDate",s.status,s.location_id AS "locationId",l.code AS "locationCode",l.name AS location,s.notes,s.created_at AS "createdAt",s.completed_at AS "completedAt" FROM inventory_stock_counts s JOIN inventory_locations l ON l.id=s.location_id AND l.organization_id=s.organization_id WHERE s.organization_id=$1 ORDER BY s.count_date DESC,s.created_at DESC`,[p.organizationId]);return c.json({data:r.rows});});
  router.post("/stock-counts",requireScope("products:write"),async c=>{const s=z.object({locationId:z.string(),countDate:z.iso.date(),offsetAccountId:z.string(),notes:z.string().max(500).optional()}).safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid stock count",s.error.flatten());const p=c.get("principal");return c.json({data:await createStockCount(runtime,p.organizationId,p.userId,s.data)},201);});
  router.get("/stock-counts/:id",requireScope("products:read"),async c=>{const p=c.get("principal"),id=c.req.param("id"),count=(await runtime.db.query(`SELECT s.id,s.count_date::text AS "countDate",s.status,s.location_id AS "locationId",l.code AS "locationCode",l.name AS location,s.offset_account_id AS "offsetAccountId",s.notes,s.created_at AS "createdAt",s.completed_at AS "completedAt" FROM inventory_stock_counts s JOIN inventory_locations l ON l.id=s.location_id AND l.organization_id=s.organization_id WHERE s.id=$1 AND s.organization_id=$2`,[id,p.organizationId])).rows[0];if(!count)throw new AppError(404,"NOT_FOUND","Stock count not found");const lines=await runtime.db.query(`SELECT cl.id,cl.product_id AS "productId",p.sku,p.name AS product,cl.expected_quantity_micros::float8 AS "expectedQuantityMicros",cl.counted_quantity_micros::float8 AS "countedQuantityMicros",cl.difference_quantity_micros::float8 AS "differenceQuantityMicros",cl.adjustment_movement_id AS "adjustmentMovementId",cl.notes FROM inventory_stock_count_lines cl JOIN products p ON p.id=cl.product_id AND p.organization_id=cl.organization_id WHERE cl.stock_count_id=$1 AND cl.organization_id=$2 ORDER BY p.sku`,[id,p.organizationId]);return c.json({data:{...count,lines:lines.rows}});});
  router.put("/stock-counts/:id/lines",requireScope("products:write"),async c=>{const s=z.object({lines:z.array(z.object({productId:z.string(),countedQuantityMicros:z.number().int().nonnegative(),notes:z.string().max(500).optional()})).min(1).max(5000)}).safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Invalid stock count lines",s.error.flatten());const p=c.get("principal");return c.json({data:await saveStockCountLines(runtime,p.organizationId,c.req.param("id"),s.data.lines)});});
  router.post("/stock-counts/:id/complete",requireScope("products:write"),async c=>{const p=c.get("principal");return c.json({data:await completeStockCount(runtime,p.organizationId,p.userId,c.req.param("id"))});});
  router.post("/stock-counts/:id/cancel",requireScope("products:write"),async c=>{const p=c.get("principal"),id=c.req.param("id"),r=await runtime.db.query(`UPDATE inventory_stock_counts SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status IN ('draft','in_progress')`,[id,p.organizationId]);if(!r.rowCount)throw new AppError(409,"INVALID_STATE","Editable stock count not found");return c.json({data:{id,status:"cancelled"}});});

  router.post("/documents/:id/fulfill",requireScope("products:write"),async c=>{const key=c.req.header("Idempotency-Key");if(!key)throw new AppError(422,"IDEMPOTENCY_KEY_REQUIRED","Idempotency-Key is required");const s=z.object({locationId:z.string()}).safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,"VALIDATION_ERROR","Location is required");const p=c.get("principal");return c.json({data:await fulfillDocument(runtime,p.organizationId,p.userId,c.req.param("id"),s.data.locationId,key)});});
  router.get("/valuation",requireScope("reports:read"),async c=>{const p=c.get("principal"),asOf=c.req.query("asOf"),productId=c.req.query("productId"),locationId=c.req.query("locationId");return c.json({data:await generateInventoryValuationReport(runtime,p.organizationId,{asOf,productId,locationId})});});
  router.get("/cogs",requireScope("reports:read"),async c=>{const p=c.get("principal"),from=c.req.query("from"),to=c.req.query("to"),productId=c.req.query("productId");return c.json(await generateCogsReport(runtime,p.organizationId,{from,to,productId}));});
  return router;
}
