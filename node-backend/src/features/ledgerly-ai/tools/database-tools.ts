import { z } from "zod";
import { prepareSafeTenantSql } from "./sql-safety.js";
import type { LedgerlyAiToolDefinition } from "./types.js";

const jsonPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const databaseTools: LedgerlyAiToolDefinition[] = [{
  name: "db.query.safe",
  category: "database",
  description: "Run a tightly constrained read-only SELECT against approved tenant-scoped Ledgerly tables. Every referenced alias must include alias.organization_id = $1.",
  inputSchema: z.object({
    sql: z.string().trim().min(1).max(12000),
    params: z.array(jsonPrimitive).max(30).default([]),
    limit: z.number().int().min(1).max(500).default(200),
  }),
  inputJsonSchema: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description: "Single SELECT only. Use $1 only for organization ID; caller values begin at $2. Every table alias must include alias.organization_id = $1.",
      },
      params: {
        type: "array",
        maxItems: 30,
        items: { type: ["string","number","boolean","null"] },
        description: "Values for $2, $3, and onward. Ledgerly supplies $1 as the current organization.",
      },
      limit: { type: "integer", minimum: 1, maximum: 500 },
    },
    required: ["sql"],
    additionalProperties: false,
  },
  requiredScopes: ["admin:read"],
  riskLevel: "medium",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const plan = prepareSafeTenantSql(
      input.sql,
      ctx.principal.organizationId,
      input.params,
      input.limit,
    );
    const client = await ctx.runtime.db.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      const result = await client.query(plan.sql, plan.params);
      await client.query("COMMIT");
      return {
        rows: result.rows,
        rowCount: result.rowCount ?? result.rows.length,
        tables: plan.tables,
        truncatedAt: input.limit,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
}];
