import type { Pool } from "pg";
import { AppError } from "../../../http/errors.js";
import type { LedgerlyAiConfig } from "../config.js";

export class LedgerlyAiRateLimiter {
  constructor(private readonly db: Pool, private readonly config: LedgerlyAiConfig) {}

  private async increment(organizationId: string, scopeType: "organization" | "user" | "agent", scopeId: string, limit: number) {
    const result = await this.db.query<{ requestCount: number }>(
      `INSERT INTO lai_rate_counters(organization_id,scope_type,scope_id,bucket_start,request_count)
       VALUES($1,$2,$3,date_trunc('minute',CURRENT_TIMESTAMP),1)
       ON CONFLICT(organization_id,scope_type,scope_id,bucket_start)
       DO UPDATE SET request_count=lai_rate_counters.request_count+1,updated_at=CURRENT_TIMESTAMP
       RETURNING request_count AS "requestCount"`,
      [organizationId, scopeType, scopeId],
    );
    const count = Number(result.rows[0]?.requestCount ?? 0);
    if (count > limit) {
      throw new AppError(429, "LEDGERLY_AI_RATE_LIMITED", "Ledgerly AI request limit reached. Try again shortly.", {
        scope: scopeType,
        limit,
        windowSeconds: 60,
      });
    }
  }

  async consume(input: { organizationId: string; userId: string; agentId?: string | null }) {
    await this.increment(input.organizationId, "organization", input.organizationId, this.config.LEDGERLY_AI_ORG_REQUESTS_PER_MINUTE);
    await this.increment(input.organizationId, "user", input.userId, this.config.LEDGERLY_AI_USER_REQUESTS_PER_MINUTE);
    if (input.agentId) {
      await this.increment(input.organizationId, "agent", input.agentId, this.config.LEDGERLY_AI_AGENT_REQUESTS_PER_MINUTE);
    }
  }
}
