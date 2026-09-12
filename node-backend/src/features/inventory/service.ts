import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import { createJournal, postJournal } from "../finance-core/service.js";
import { assertPostingDateOpen } from "../fiscal-periods/service.js";

type Db = Pool | PoolClient;
export type MovementType = "opening" | "receipt" | "issue" | "adjustment" | "sale_return" | "purchase_return" | "reversal";
export type MovementInput = {
  productId: string;
  locationId: string;
  type: MovementType;
  movementDate: string;
  quantityDeltaMicros: number;
  unitCostMinor?: number;
  offsetAccountId?: string;
  sourceType?: string;
  sourceId?: string;
  reversalOfId?: string;
};

async function audit(db: Db, organizationId: string, actorId: string, action: string, entityType: string, entityId: string, after?: unknown) {
  await db.query(
    `INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [createId("aud"), organizationId, actorId, action, entityType, entityId, after === undefined ? null : JSON.stringify(after)],
  );
}

async function productAndBalance(db: Db, organizationId: string, productId: string, locationId: string, lock = false) {
  const product = (await db.query<{
    id: string; sku: string; name: string; inventoryAccountId: string | null; expenseAccountId: string | null;
    averageCostMinor: number; baseCurrency: string; active: boolean; type: string;
  }>(
    `SELECT p.id,p.sku,p.name,p.inventory_account_id AS "inventoryAccountId",p.expense_account_id AS "expenseAccountId",
      p.average_cost_minor::float8 AS "averageCostMinor",o.base_currency AS "baseCurrency",p.active,p.type
     FROM products p JOIN organizations o ON o.id=p.organization_id
     WHERE p.id=$1 AND p.organization_id=$2${lock ? " FOR UPDATE OF p" : ""}`,
    [productId, organizationId],
  )).rows[0];
  if (!product || !product.active || product.type !== "inventory" || !product.inventoryAccountId) {
    throw new AppError(422, "INVALID_INVENTORY_PRODUCT", "Product must be an active inventory product with an inventory asset account");
  }
  const location = (await db.query<{ id: string; active: boolean }>(
    `SELECT id,active FROM inventory_locations WHERE id=$1 AND organization_id=$2${lock ? " FOR UPDATE" : ""}`,
    [locationId, organizationId],
  )).rows[0];
  if (!location?.active) throw new AppError(422, "INVALID_LOCATION", "Inventory location is invalid or inactive");
  await db.query(
    `INSERT INTO inventory_balances(organization_id,product_id,location_id) VALUES($1,$2,$3)
     ON CONFLICT (organization_id,product_id,location_id) DO NOTHING`,
    [organizationId, productId, locationId],
  );
  const balance = (await db.query<{ quantity: number; value: number; reserved: number }>(
    `SELECT quantity_micros::float8 AS quantity,inventory_value_minor::float8 AS value,reserved_quantity_micros::float8 AS reserved
     FROM inventory_balances WHERE organization_id=$1 AND product_id=$2 AND location_id=$3${lock ? " FOR UPDATE" : ""}`,
    [organizationId, productId, locationId],
  )).rows[0] ?? { quantity: 0, value: 0, reserved: 0 };
  return { product, location, balance };
}

function safeInteger(value: number, code: string, message: string) {
  if (!Number.isSafeInteger(value)) throw new AppError(422, code, message);
}

function movementSignIsValid(type: MovementType, quantity: number) {
  if (["opening", "receipt", "sale_return"].includes(type) && quantity <= 0) return false;
  if (["issue", "purchase_return"].includes(type) && quantity >= 0) return false;
  return quantity !== 0;
}

export async function recordMovement(runtime: Runtime, organizationId: string, actorId: string, input: MovementInput, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length > 200) throw new AppError(422, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required");
  safeInteger(input.quantityDeltaMicros, "INVALID_QUANTITY", "Quantity delta must be an integer in micro-units");
  if (!movementSignIsValid(input.type, input.quantityDeltaMicros)) throw new AppError(422, "INVALID_QUANTITY", "Movement quantity sign does not match the movement type");
  if (input.unitCostMinor !== undefined) {
    safeInteger(input.unitCostMinor, "INVALID_COST", "Unit cost must be an integer in minor currency units");
    if (input.unitCostMinor < 0) throw new AppError(422, "INVALID_COST", "Unit cost cannot be negative");
  }

  const locker = await runtime.db.connect();
  const lockKey = `inventory:${organizationId}:${input.productId}`;
  try {
    await locker.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [lockKey]);
    const existing = (await locker.query<{
      id: string; status: string; journalEntryId: string | null; quantityDeltaMicros: number; unitCostMinor: number; valueDeltaMinor: number;
    }>(
      `SELECT id,status,journal_entry_id AS "journalEntryId",quantity_delta_micros::float8 AS "quantityDeltaMicros",
        unit_cost_minor::float8 AS "unitCostMinor",value_delta_minor::float8 AS "valueDeltaMinor"
       FROM inventory_movements WHERE organization_id=$1 AND idempotency_key=$2`,
      [organizationId, idempotencyKey],
    )).rows[0];
    if (existing?.status === "posted" || existing?.status === "reversed") return { ...existing, replayed: true };

    await assertPostingDateOpen(locker, organizationId, input.movementDate);
    const pendingOther = await locker.query(
      `SELECT id FROM inventory_movements WHERE organization_id=$1 AND product_id=$2 AND status='pending'
       AND idempotency_key<>$3 LIMIT 1`,
      [organizationId, input.productId, idempotencyKey],
    );
    if (pendingOther.rowCount) throw new AppError(409, "INVENTORY_PENDING_MOVEMENT", "A previous inventory movement for this product must be completed or retried first");

    let movementId = existing?.id;
    let quantityDelta = existing?.quantityDeltaMicros ?? input.quantityDeltaMicros;
    let unitCost = existing?.unitCostMinor;
    let valueDelta = existing?.valueDeltaMinor;
    let offsetAccountId = input.offsetAccountId ?? null;
    let inventoryAccountId: string;
    let currency: string;

    const setup = await productAndBalance(locker, organizationId, input.productId, input.locationId, true);
    inventoryAccountId = setup.product.inventoryAccountId!;
    currency = setup.product.baseCurrency;

    if (!existing) {
      const available = setup.balance.quantity - setup.balance.reserved;
      if (quantityDelta < 0 && available < Math.abs(quantityDelta)) {
        throw new AppError(409, "NEGATIVE_STOCK", "Movement exceeds available stock", { onHandMicros: setup.balance.quantity, reservedMicros: setup.balance.reserved, availableMicros: available, requestedMicros: Math.abs(quantityDelta) });
      }
      const incoming = quantityDelta > 0;
      const computedAverage = setup.balance.quantity > 0 ? Math.round(setup.balance.value * 1_000_000 / setup.balance.quantity) : setup.product.averageCostMinor;
      unitCost = input.unitCostMinor ?? computedAverage;
      safeInteger(unitCost, "INVALID_COST", "Unit cost must be a safe integer");
      if (unitCost < 0) throw new AppError(422, "INVALID_COST", "Unit cost cannot be negative");
      const absoluteValue = Math.round(Math.abs(quantityDelta) * unitCost / 1_000_000);
      safeInteger(absoluteValue, "INVALID_VALUE", "Inventory movement value is too large");
      valueDelta = incoming ? absoluteValue : -absoluteValue;
      if (setup.balance.value + valueDelta < 0) throw new AppError(409, "NEGATIVE_INVENTORY_VALUE", "Movement would make inventory value negative");
      offsetAccountId = input.offsetAccountId ?? (!incoming ? setup.product.expenseAccountId : null);
      if (absoluteValue > 0 && !offsetAccountId) {
        throw new AppError(422, "OFFSET_ACCOUNT_REQUIRED", incoming ? "Incoming inventory requires an offset account" : "Outgoing inventory requires an expense/COGS or offset account");
      }
      if (offsetAccountId) {
        const account = (await locker.query<{ active: boolean; allowPosting: boolean }>(
          `SELECT active,allow_posting AS "allowPosting" FROM accounts WHERE id=$1 AND organization_id=$2`,
          [offsetAccountId, organizationId],
        )).rows[0];
        if (!account?.active || !account.allowPosting) throw new AppError(422, "INVALID_ACCOUNT", "Inventory offset account is invalid or not postable");
        if (offsetAccountId === inventoryAccountId) throw new AppError(422, "INVALID_ACCOUNT", "Inventory and offset accounts must differ");
      }
      movementId = createId("mov");
      await locker.query(
        `INSERT INTO inventory_movements(id,organization_id,product_id,location_id,type,movement_date,quantity_delta_micros,
          unit_cost_minor,value_delta_minor,offset_account_id,source_type,source_id,idempotency_key,status,reversal_of_id,created_by)
         VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,'pending',$14,$15)`,
        [movementId, organizationId, input.productId, input.locationId, input.type, input.movementDate, quantityDelta, unitCost, valueDelta,
          offsetAccountId, input.sourceType ?? "manual", input.sourceId ?? null, idempotencyKey, input.reversalOfId ?? null, actorId],
      );
    } else {
      const row = (await locker.query<{ inventoryAccountId: string; offsetAccountId: string | null; currency: string }>(
        `SELECT p.inventory_account_id AS "inventoryAccountId",m.offset_account_id AS "offsetAccountId",o.base_currency AS currency
         FROM inventory_movements m JOIN products p ON p.id=m.product_id AND p.organization_id=m.organization_id
         JOIN organizations o ON o.id=m.organization_id WHERE m.id=$1 AND m.organization_id=$2`,
        [movementId, organizationId],
      )).rows[0]!;
      inventoryAccountId = row.inventoryAccountId;
      offsetAccountId = row.offsetAccountId;
      currency = row.currency;
    }

    let journalEntryId: string | null = existing?.journalEntryId ?? null;
    const absoluteValue = Math.abs(valueDelta ?? 0);
    if (absoluteValue > 0) {
      const incoming = quantityDelta > 0;
      const journal = await createJournal(runtime, organizationId, actorId, {
        transactionDate: input.movementDate,
        postingDate: input.movementDate,
        description: `Inventory ${input.type}`,
        reference: input.sourceId,
        currency,
        sourceType: "inventory_movement",
        sourceId: movementId,
        lines: [
          { accountId: inventoryAccountId, description: input.type, ...(incoming ? { debitMinor: absoluteValue } : { creditMinor: absoluteValue }) },
          { accountId: offsetAccountId!, description: input.type, ...(incoming ? { creditMinor: absoluteValue } : { debitMinor: absoluteValue }) },
        ],
      }, `inventory:${organizationId}:${idempotencyKey}:journal`);
      if (journal.status === "draft") await postJournal(runtime, organizationId, actorId, journal.id);
      journalEntryId = journal.id;
    }

    await locker.query("BEGIN");
    try {
      const movement = (await locker.query<{ status: string }>(
        `SELECT status FROM inventory_movements WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [movementId, organizationId],
      )).rows[0];
      if (!movement) throw new AppError(404, "NOT_FOUND", "Inventory movement not found");
      if (movement.status === "posted" || movement.status === "reversed") {
        await locker.query("COMMIT");
        return { id: movementId, status: movement.status, journalEntryId, replayed: true };
      }
      const current = await productAndBalance(locker, organizationId, input.productId, input.locationId, true);
      const nextQuantity = current.balance.quantity + quantityDelta;
      const nextValue = current.balance.value + (valueDelta ?? 0);
      if (nextQuantity < current.balance.reserved || nextQuantity < 0) throw new AppError(409, "NEGATIVE_STOCK", "Movement would reduce stock below reserved or zero quantity");
      if (nextValue < 0) throw new AppError(409, "NEGATIVE_INVENTORY_VALUE", "Movement would make inventory value negative");
      await locker.query(
        `UPDATE inventory_balances SET quantity_micros=$1,inventory_value_minor=$2,updated_at=CURRENT_TIMESTAMP
         WHERE organization_id=$3 AND product_id=$4 AND location_id=$5`,
        [nextQuantity, nextValue, organizationId, input.productId, input.locationId],
      );
      await locker.query(
        `UPDATE inventory_movements SET status='posted',journal_entry_id=$1,updated_at=CURRENT_TIMESTAMP
         WHERE id=$2 AND organization_id=$3 AND status='pending'`,
        [journalEntryId, movementId, organizationId],
      );
      await audit(locker, organizationId, actorId, "inventory.movement_posted", "inventory_movement", movementId!, {
        ...input, unitCostMinor: unitCost, valueDeltaMinor: valueDelta, journalEntryId,
      });
      await locker.query("COMMIT");
      return { id: movementId, status: "posted", quantityOnHandMicros: nextQuantity, inventoryValueMinor: nextValue, unitCostMinor: unitCost, valueDeltaMinor: valueDelta, journalEntryId };
    } catch (error) {
      await locker.query("ROLLBACK");
      throw error;
    }
  } finally {
    await locker.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]).catch(() => undefined);
    locker.release();
  }
}

export async function transferStock(runtime: Runtime, organizationId: string, actorId: string, input: { productId: string; fromLocationId: string; toLocationId: string; movementDate: string; quantityMicros: number }, idempotencyKey: string) {
  safeInteger(input.quantityMicros, "INVALID_QUANTITY", "Transfer quantity must be an integer in micro-units");
  if (input.quantityMicros <= 0) throw new AppError(422, "INVALID_QUANTITY", "Transfer quantity must be positive");
  if (input.fromLocationId === input.toLocationId) throw new AppError(422, "INVALID_TRANSFER", "Transfer locations must differ");
  const client = await runtime.db.connect();
  const lockKey = `inventory:${organizationId}:${input.productId}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [lockKey]);
    const existing = (await client.query<{ id: string }>(
      `SELECT transfer_group_id AS id FROM inventory_movements WHERE organization_id=$1 AND idempotency_key=$2`,
      [organizationId, `${idempotencyKey}:out`],
    )).rows[0];
    if (existing?.id) return { id: existing.id, replayed: true };
    await assertPostingDateOpen(client, organizationId, input.movementDate);
    await client.query("BEGIN");
    const from = await productAndBalance(client, organizationId, input.productId, input.fromLocationId, true);
    const to = await productAndBalance(client, organizationId, input.productId, input.toLocationId, true);
    const available = from.balance.quantity - from.balance.reserved;
    if (available < input.quantityMicros) throw new AppError(409, "NEGATIVE_STOCK", "Insufficient available stock at source location", { availableMicros: available });
    const unitCost = from.balance.quantity > 0 ? Math.round(from.balance.value * 1_000_000 / from.balance.quantity) : from.product.averageCostMinor;
    const value = Math.round(input.quantityMicros * unitCost / 1_000_000);
    if (from.balance.value < value) throw new AppError(409, "NEGATIVE_INVENTORY_VALUE", "Transfer exceeds source inventory value");
    const group = createId("xfr");
    await client.query(
      `INSERT INTO inventory_movements(id,organization_id,product_id,location_id,type,movement_date,quantity_delta_micros,unit_cost_minor,value_delta_minor,source_type,transfer_group_id,idempotency_key,status,created_by)
       VALUES($1,$2,$3,$4,'transfer_out',$5::date,$6,$7,$8,'transfer',$9,$10,'posted',$11),
             ($12,$2,$3,$13,'transfer_in',$5::date,$14,$7,$15,'transfer',$9,$16,'posted',$11)`,
      [createId("mov"), organizationId, input.productId, input.fromLocationId, input.movementDate, -input.quantityMicros, unitCost, -value, group, `${idempotencyKey}:out`, actorId,
        createId("mov"), input.toLocationId, input.quantityMicros, value, `${idempotencyKey}:in`],
    );
    await client.query(
      `UPDATE inventory_balances SET quantity_micros=quantity_micros-$1,inventory_value_minor=inventory_value_minor-$2,updated_at=CURRENT_TIMESTAMP
       WHERE organization_id=$3 AND product_id=$4 AND location_id=$5`,
      [input.quantityMicros, value, organizationId, input.productId, input.fromLocationId],
    );
    await client.query(
      `UPDATE inventory_balances SET quantity_micros=quantity_micros+$1,inventory_value_minor=inventory_value_minor+$2,updated_at=CURRENT_TIMESTAMP
       WHERE organization_id=$3 AND product_id=$4 AND location_id=$5`,
      [input.quantityMicros, value, organizationId, input.productId, input.toLocationId],
    );
    await audit(client, organizationId, actorId, "inventory.transferred", "inventory_transfer", group, input);
    await client.query("COMMIT");
    return { id: group, unitCostMinor: unitCost, valueMinor: value };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [lockKey]).catch(() => undefined);
    client.release();
  }
}

export async function reverseMovement(runtime: Runtime, organizationId: string, actorId: string, movementId: string, reversalDate: string, reason: string) {
  const original = (await runtime.db.query<{
    id: string; productId: string; locationId: string; quantityDeltaMicros: number; unitCostMinor: number; offsetAccountId: string | null; status: string;
  }>(
    `SELECT id,product_id AS "productId",location_id AS "locationId",quantity_delta_micros::float8 AS "quantityDeltaMicros",
      unit_cost_minor::float8 AS "unitCostMinor",offset_account_id AS "offsetAccountId",status
     FROM inventory_movements WHERE id=$1 AND organization_id=$2`,
    [movementId, organizationId],
  )).rows[0];
  if (!original) throw new AppError(404, "NOT_FOUND", "Inventory movement not found");
  if (original.status === "reversed") {
    const reversal = (await runtime.db.query<{ id: string }>("SELECT reversed_by_movement_id AS id FROM inventory_movements WHERE id=$1", [movementId])).rows[0];
    return { id: reversal?.id, replayed: true };
  }
  if (original.status !== "posted") throw new AppError(409, "INVALID_STATE", "Only posted movements can be reversed");
  if (!original.offsetAccountId && original.unitCostMinor > 0) throw new AppError(409, "REVERSAL_BLOCKED", "This movement has no accounting offset account");
  const reversal = await recordMovement(runtime, organizationId, actorId, {
    productId: original.productId, locationId: original.locationId, type: "reversal", movementDate: reversalDate,
    quantityDeltaMicros: -original.quantityDeltaMicros, unitCostMinor: original.unitCostMinor, offsetAccountId: original.offsetAccountId ?? undefined,
    sourceType: "inventory_reversal", sourceId: movementId, reversalOfId: movementId,
  }, `inventory-reversal:${movementId}`);
  await runtime.db.query(
    `UPDATE inventory_movements SET status='reversed',reversed_by_movement_id=$1,updated_at=CURRENT_TIMESTAMP
     WHERE id=$2 AND organization_id=$3 AND status='posted'`,
    [reversal.id, movementId, organizationId],
  );
  await audit(runtime.db, organizationId, actorId, "inventory.movement_reversed", "inventory_movement", movementId, { reversalMovementId: reversal.id, reversalDate, reason });
  return { originalMovementId: movementId, reversalMovementId: reversal.id, status: "reversed" };
}

export async function reserveStock(runtime: Runtime, organizationId: string, actorId: string, input: { productId: string; locationId: string; quantityMicros: number; sourceType: string; sourceId: string; expiresAt?: string }) {
  if (!Number.isSafeInteger(input.quantityMicros) || input.quantityMicros <= 0) throw new AppError(422, "INVALID_QUANTITY", "Reservation quantity must be positive");
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const { balance } = await productAndBalance(client, organizationId, input.productId, input.locationId, true);
    const available = balance.quantity - balance.reserved;
    if (available < input.quantityMicros) throw new AppError(409, "INSUFFICIENT_AVAILABLE_STOCK", "Reservation exceeds available stock", { availableMicros: available });
    const id = createId("rsv");
    await client.query(
      `INSERT INTO inventory_reservations(id,organization_id,product_id,location_id,quantity_micros,source_type,source_id,expires_at,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9)`,
      [id, organizationId, input.productId, input.locationId, input.quantityMicros, input.sourceType, input.sourceId, input.expiresAt ?? null, actorId],
    );
    await audit(client, organizationId, actorId, "inventory.reserved", "inventory_reservation", id, input);
    await client.query("COMMIT");
    return { id, status: "active" as const, ...input };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function changeReservation(runtime: Runtime, organizationId: string, actorId: string, id: string, action: "release" | "consume") {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query<{ status: string }>(`SELECT status FROM inventory_reservations WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [id, organizationId])).rows[0];
    if (!row) throw new AppError(404, "NOT_FOUND", "Inventory reservation not found");
    if (row.status !== "active") throw new AppError(409, "INVALID_STATE", "Only active reservations can be changed");
    const status = action === "release" ? "released" : "consumed";
    await client.query(
      `UPDATE inventory_reservations SET status=$1,released_at=CASE WHEN $1='released' THEN CURRENT_TIMESTAMP ELSE released_at END,
       consumed_at=CASE WHEN $1='consumed' THEN CURRENT_TIMESTAMP ELSE consumed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,
      [status, id, organizationId],
    );
    await audit(client, organizationId, actorId, `inventory.reservation_${status}`, "inventory_reservation", id);
    await client.query("COMMIT");
    return { id, status };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function releaseExpiredReservations(runtime: Runtime) {
  const result = await runtime.db.query(
    `UPDATE inventory_reservations SET status='released',released_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
     WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=CURRENT_TIMESTAMP`,
  );
  return result.rowCount ?? 0;
}

export async function createStockCount(runtime: Runtime, organizationId: string, actorId: string, input: { locationId: string; countDate: string; offsetAccountId: string; notes?: string }) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const location = await client.query("SELECT 1 FROM inventory_locations WHERE id=$1 AND organization_id=$2 AND active=true", [input.locationId, organizationId]);
    if (!location.rowCount) throw new AppError(422, "INVALID_LOCATION", "Inventory location is invalid");
    const account = await client.query("SELECT 1 FROM accounts WHERE id=$1 AND organization_id=$2 AND active=true AND allow_posting=true", [input.offsetAccountId, organizationId]);
    if (!account.rowCount) throw new AppError(422, "INVALID_ACCOUNT", "Stock-count offset account is invalid");
    const id = createId("stk");
    await client.query(
      `INSERT INTO inventory_stock_counts(id,organization_id,location_id,count_date,offset_account_id,notes,created_by)
       VALUES($1,$2,$3,$4::date,$5,$6,$7)`,
      [id, organizationId, input.locationId, input.countDate, input.offsetAccountId, input.notes ?? null, actorId],
    );
    await client.query(
      `INSERT INTO inventory_stock_count_lines(id,organization_id,stock_count_id,product_id,expected_quantity_micros)
       SELECT 'scl_'||md5($1||':'||p.id),$2,$1,p.id,COALESCE(b.quantity_micros,0)
       FROM products p LEFT JOIN inventory_balances b ON b.organization_id=p.organization_id AND b.product_id=p.id AND b.location_id=$3
       WHERE p.organization_id=$2 AND p.type='inventory' AND p.active=true`,
      [id, organizationId, input.locationId],
    );
    await audit(client, organizationId, actorId, "inventory.stock_count_created", "inventory_stock_count", id, input);
    await client.query("COMMIT");
    return { id, status: "draft" as const, ...input };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function saveStockCountLines(runtime: Runtime, organizationId: string, id: string, lines: Array<{ productId: string; countedQuantityMicros: number; notes?: string }>) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const count = (await client.query<{ status: string }>(`SELECT status FROM inventory_stock_counts WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [id, organizationId])).rows[0];
    if (!count) throw new AppError(404, "NOT_FOUND", "Stock count not found");
    if (!["draft", "in_progress"].includes(count.status)) throw new AppError(409, "INVALID_STATE", "Completed or cancelled stock counts cannot be edited");
    for (const line of lines) {
      if (!Number.isSafeInteger(line.countedQuantityMicros) || line.countedQuantityMicros < 0) throw new AppError(422, "INVALID_QUANTITY", "Counted quantity must be a non-negative integer");
      const result = await client.query(
        `UPDATE inventory_stock_count_lines SET counted_quantity_micros=$1,difference_quantity_micros=$1-expected_quantity_micros,notes=$2,updated_at=CURRENT_TIMESTAMP
         WHERE stock_count_id=$3 AND organization_id=$4 AND product_id=$5`,
        [line.countedQuantityMicros, line.notes ?? null, id, organizationId, line.productId],
      );
      if (!result.rowCount) throw new AppError(422, "INVALID_PRODUCT", "Stock-count product was not part of this count");
    }
    await client.query("UPDATE inventory_stock_counts SET status='in_progress',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2", [id, organizationId]);
    await client.query("COMMIT");
    return { id, updatedLines: lines.length };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function completeStockCount(runtime: Runtime, organizationId: string, actorId: string, id: string) {
  const count = (await runtime.db.query<{ locationId: string; countDate: string; offsetAccountId: string; status: string }>(
    `SELECT location_id AS "locationId",count_date::text AS "countDate",offset_account_id AS "offsetAccountId",status
     FROM inventory_stock_counts WHERE id=$1 AND organization_id=$2`, [id, organizationId],
  )).rows[0];
  if (!count) throw new AppError(404, "NOT_FOUND", "Stock count not found");
  if (count.status === "completed") return { id, status: "completed", replayed: true };
  if (count.status === "cancelled") throw new AppError(409, "INVALID_STATE", "Cancelled stock counts cannot be completed");
  const lines = await runtime.db.query<{ id: string; productId: string; difference: number | null }>(
    `SELECT id,product_id AS "productId",difference_quantity_micros::float8 AS difference FROM inventory_stock_count_lines
     WHERE stock_count_id=$1 AND organization_id=$2 ORDER BY id`, [id, organizationId],
  );
  if (lines.rows.some((line) => line.difference === null)) throw new AppError(409, "COUNT_INCOMPLETE", "Every stock-count line must have a counted quantity");
  for (const line of lines.rows) {
    if (!line.difference) continue;
    const movement = await recordMovement(runtime, organizationId, actorId, {
      productId: line.productId, locationId: count.locationId, type: "adjustment", movementDate: count.countDate,
      quantityDeltaMicros: line.difference, offsetAccountId: count.offsetAccountId, sourceType: "stock_count", sourceId: id,
    }, `stock-count:${id}:${line.id}`);
    await runtime.db.query(
      `UPDATE inventory_stock_count_lines SET adjustment_movement_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,
      [movement.id, line.id, organizationId],
    );
  }
  await runtime.db.query(
    `UPDATE inventory_stock_counts SET status='completed',completed_by=$1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
     WHERE id=$2 AND organization_id=$3 AND status<>'completed'`, [actorId, id, organizationId],
  );
  await audit(runtime.db, organizationId, actorId, "inventory.stock_count_completed", "inventory_stock_count", id);
  return { id, status: "completed" as const };
}

export async function fulfillDocument(runtime: Runtime, organizationId: string, actorId: string, documentId: string, locationId: string, idempotencyKey: string) {
  const document = (await runtime.db.query<{ type: string; status: string; issueDate: string }>(
    `SELECT type,status,issue_date::text AS "issueDate" FROM documents WHERE id=$1 AND organization_id=$2`, [documentId, organizationId],
  )).rows[0];
  if (!document) throw new AppError(404, "NOT_FOUND", "Document not found");
  if (!['invoice','credit_note'].includes(document.type) || !['open','partially_paid','paid'].includes(document.status)) {
    throw new AppError(409, "DOCUMENT_NOT_FULFILLABLE", "Only posted invoices and credit notes can create inventory COGS movements");
  }
  const lines = await runtime.db.query<{ id: string; productId: string; quantityMicros: number }>(
    `SELECT dl.id,dl.product_id AS "productId",dl.quantity_micros::float8 AS "quantityMicros"
     FROM document_lines dl JOIN products p ON p.id=dl.product_id AND p.organization_id=dl.organization_id
     WHERE dl.document_id=$1 AND dl.organization_id=$2 AND p.type='inventory' AND p.active=true ORDER BY dl.id`,
    [documentId, organizationId],
  );
  const movements: unknown[] = [];
  for (const line of lines.rows) {
    const quantity = document.type === 'invoice' ? -Math.abs(line.quantityMicros) : Math.abs(line.quantityMicros);
    movements.push(await recordMovement(runtime, organizationId, actorId, {
      productId: line.productId, locationId, type: document.type === 'invoice' ? 'issue' : 'sale_return', movementDate: document.issueDate,
      quantityDeltaMicros: quantity, sourceType: 'document_cogs', sourceId: documentId,
    }, `${idempotencyKey}:${line.id}`));
  }
  return { documentId, movementCount: movements.length, movements };
}

export async function generateInventoryValuationReport(runtime: Pick<Runtime,"db">, organizationId: string, filters: { asOf?: string; to?: string; productId?: string; locationId?: string } = {}) {
  const asOf = filters.asOf ?? filters.to ?? new Date().toISOString().slice(0, 10);
  const params: unknown[] = [organizationId, asOf];
  const conditions = ["m.organization_id=$1", "m.status='posted'", "m.movement_date<=$2::date"];
  if (filters.productId) { params.push(filters.productId); conditions.push(`m.product_id=$${params.length}`); }
  if (filters.locationId) { params.push(filters.locationId); conditions.push(`m.location_id=$${params.length}`); }
  const result = await runtime.db.query<{
    productId: string; sku: string; product: string; locationId: string; locationCode: string; location: string;
    quantityMicros: number; inventoryValueMinor: number;
  }>(
    `SELECT p.id AS "productId",p.sku,p.name AS product,l.id AS "locationId",l.code AS "locationCode",l.name AS location,
      COALESCE(SUM(m.quantity_delta_micros),0)::float8 AS "quantityMicros",COALESCE(SUM(m.value_delta_minor),0)::float8 AS "inventoryValueMinor"
     FROM inventory_movements m JOIN products p ON p.id=m.product_id AND p.organization_id=m.organization_id
     JOIN inventory_locations l ON l.id=m.location_id AND l.organization_id=m.organization_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY p.id,p.sku,p.name,l.id,l.code,l.name
     HAVING COALESCE(SUM(m.quantity_delta_micros),0)<>0 OR COALESCE(SUM(m.value_delta_minor),0)<>0
     ORDER BY p.sku,l.code`, params,
  );
  const rows = result.rows.map((row) => ({ ...row, averageCostMinor: row.quantityMicros ? Math.round(row.inventoryValueMinor * 1_000_000 / row.quantityMicros) : 0 }));
  return {
    reportType: "inventory-valuation" as const,
    generatedAt: new Date().toISOString(),
    filters: { ...filters, asOf },
    columns: ["sku","product","locationCode","location","quantityMicros","averageCostMinor","inventoryValueMinor"],
    rows,
    totals: { quantityMicros: rows.reduce((sum, row) => sum + row.quantityMicros, 0), inventoryValueMinor: rows.reduce((sum, row) => sum + row.inventoryValueMinor, 0) },
  };
}

export async function generateCogsReport(runtime: Pick<Runtime,"db">, organizationId: string, filters: { from?: string; to?: string; productId?: string } = {}) {
  const from = filters.from ?? "0001-01-01", to = filters.to ?? "9999-12-31";
  const params: unknown[] = [organizationId, from, to];
  let productSql = "";
  if (filters.productId) { params.push(filters.productId); productSql = ` AND m.product_id=$${params.length}`; }
  const result = await runtime.db.query(
    `SELECT p.id AS "productId",p.sku,p.name AS product,COALESCE(SUM(-m.quantity_delta_micros),0)::float8 AS "quantityIssuedMicros",
      COALESCE(SUM(-m.value_delta_minor),0)::float8 AS "cogsMinor"
     FROM inventory_movements m JOIN products p ON p.id=m.product_id AND p.organization_id=m.organization_id
     WHERE m.organization_id=$1 AND m.status='posted' AND m.type IN ('issue','purchase_return') AND m.movement_date BETWEEN $2::date AND $3::date${productSql}
     GROUP BY p.id,p.sku,p.name ORDER BY p.sku`, params,
  );
  return { data: result.rows, totals: { cogsMinor: result.rows.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.cogsMinor ?? 0), 0) } };
}
