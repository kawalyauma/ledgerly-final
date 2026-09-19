import type { Pool } from "pg";
import { AppError } from "../../../http/errors.js";
import { sha256 } from "../../core-identity/security.js";

export class LedgerlyAiIdempotency {
  constructor(private readonly db: Pool) {}

  hash(payload: unknown) {
    return sha256(JSON.stringify(payload));
  }

  async claim(input: { organizationId: string; userId: string; key?: string | null; requestHash: string }) {
    if (!input.key) return { mode: "fresh" as const };
    if (input.key.length > 200) throw new AppError(422, "INVALID_IDEMPOTENCY_KEY", "Idempotency key is too long.");

    const inserted = await this.db.query(
      `INSERT INTO lai_idempotency_keys(organization_id,user_id,idempotency_key,request_hash,status)
       VALUES($1,$2,$3,$4,'processing')
       ON CONFLICT(organization_id,user_id,idempotency_key) DO UPDATE
         SET request_hash=EXCLUDED.request_hash,status='processing',response_json=NULL,error_code=NULL,
             updated_at=CURRENT_TIMESTAMP,expires_at=CURRENT_TIMESTAMP + INTERVAL '24 hours'
       WHERE lai_idempotency_keys.expires_at <= CURRENT_TIMESTAMP
       RETURNING idempotency_key`,
      [input.organizationId, input.userId, input.key, input.requestHash],
    );
    if (inserted.rowCount) return { mode: "fresh" as const };

    const existing = await this.db.query<{ requestHash: string; status: string; response: unknown }>(
      `SELECT request_hash AS "requestHash",status,response_json AS response
         FROM lai_idempotency_keys
        WHERE organization_id=$1 AND user_id=$2 AND idempotency_key=$3`,
      [input.organizationId, input.userId, input.key],
    );
    const row = existing.rows[0];
    if (!row) return { mode: "fresh" as const };
    if (row.requestHash !== input.requestHash) {
      throw new AppError(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different request.");
    }
    if (row.status === "completed") return { mode: "replay" as const, response: row.response };
    if (row.status === "processing") {
      throw new AppError(409, "REQUEST_IN_PROGRESS", "An identical Ledgerly AI request is already being processed.");
    }

    const reclaimed = await this.db.query(
      `UPDATE lai_idempotency_keys SET status='processing',error_code=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE organization_id=$1 AND user_id=$2 AND idempotency_key=$3 AND status='failed'
        RETURNING idempotency_key`,
      [input.organizationId, input.userId, input.key],
    );
    if (reclaimed.rowCount) return { mode: "fresh" as const };
    throw new AppError(409, "REQUEST_IN_PROGRESS", "An identical Ledgerly AI request is already being processed.");
  }

  async complete(input: { organizationId: string; userId: string; key?: string | null; response: unknown }) {
    if (!input.key) return;
    await this.db.query(
      `UPDATE lai_idempotency_keys SET status='completed',response_json=$1::jsonb,updated_at=CURRENT_TIMESTAMP
        WHERE organization_id=$2 AND user_id=$3 AND idempotency_key=$4`,
      [JSON.stringify(input.response), input.organizationId, input.userId, input.key],
    );
  }

  async fail(input: { organizationId: string; userId: string; key?: string | null; errorCode?: string }) {
    if (!input.key) return;
    await this.db.query(
      `UPDATE lai_idempotency_keys SET status='failed',error_code=$1,updated_at=CURRENT_TIMESTAMP
        WHERE organization_id=$2 AND user_id=$3 AND idempotency_key=$4`,
      [input.errorCode ?? "FAILED", input.organizationId, input.userId, input.key],
    );
  }
}
