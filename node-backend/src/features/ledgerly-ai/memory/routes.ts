import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import { createLedgerlyAiCorrelationId } from "../logger.js";
import { LEDGERLY_AI_MEMORY_KINDS, LEDGERLY_AI_MEMORY_SCOPES } from "./types.js";
import type { LedgerlyAiMemoryService } from "./service.js";

const createSchema = z.object({
  scopeType: z.enum(LEDGERLY_AI_MEMORY_SCOPES),
  scopeId: z.string().min(1).max(160).nullable().optional(),
  kind: z.enum(LEDGERLY_AI_MEMORY_KINDS).default("fact"),
  title: z.string().trim().max(240).nullable().optional(),
  content: z.string().trim().min(1).max(30000),
  importance: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(1),
  sourceType: z.string().trim().min(1).max(80).default("manual"),
  sourceId: z.string().max(200).nullable().optional(),
  requiredScope: z.string().max(120).nullable().optional(),
  pinned: z.boolean().default(false),
  expiresAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateSchema = z.object({
  title: z.string().trim().max(240).nullable().optional(),
  content: z.string().trim().min(1).max(30000).optional(),
  kind: z.enum(LEDGERLY_AI_MEMORY_KINDS).optional(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  requiredScope: z.string().max(120).nullable().optional(),
  pinned: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().trim().max(1000).optional(),
}).refine((value) => Object.keys(value).some((key) => key !== "reason"), "At least one memory change is required.");

export function createLedgerlyAiMemoryRoutes(memory: LedgerlyAiMemoryService) {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const parsed = z.object({
      scopeType: z.enum(LEDGERLY_AI_MEMORY_SCOPES).optional(),
      scopeId: z.string().min(1).max(160).optional(),
      status: z.enum(["active","expired","deleted"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }).safeParse({
      scopeType: c.req.query("scopeType"),
      scopeId: c.req.query("scopeId"),
      status: c.req.query("status"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid memory query.", parsed.error.flatten());
    return c.json({ data: await memory.list(c.get("principal"), parsed.data) });
  });

  routes.post("/", async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid memory.", parsed.error.flatten());
    const correlationId = createLedgerlyAiCorrelationId("laim");
    const result = await memory.create(c.get("principal"), parsed.data, correlationId);
    return c.json({ data: result, correlationId }, 201);
  });

  routes.get("/:id", async (c) => {
    return c.json({ data: await memory.get(c.get("principal"), c.req.param("id")) });
  });

  routes.patch("/:id", async (c) => {
    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid memory update.", parsed.error.flatten());
    const { reason, ...changes } = parsed.data;
    const correlationId = createLedgerlyAiCorrelationId("laim");
    const result = await memory.update(c.get("principal"), c.req.param("id"), changes, correlationId, reason);
    return c.json({ data: result, correlationId });
  });

  routes.post("/:id/correct", async (c) => {
    const parsed = z.object({
      title: z.string().trim().max(240).nullable().optional(),
      content: z.string().trim().min(1).max(30000),
      confidence: z.number().min(0).max(1).optional(),
      reason: z.string().trim().min(1).max(1000).optional(),
    }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid memory correction.", parsed.error.flatten());
    const correlationId = createLedgerlyAiCorrelationId("laim");
    const result = await memory.correct(c.get("principal"), c.req.param("id"), parsed.data, correlationId);
    return c.json({ data: result, correlationId }, 201);
  });

  routes.post("/:id/expire", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { reason?: string };
    const correlationId = createLedgerlyAiCorrelationId("laim");
    const result = await memory.setStatus(c.get("principal"), c.req.param("id"), "expired", correlationId, body.reason);
    return c.json({ data: result, correlationId });
  });

  routes.post("/:id/restore", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { reason?: string };
    const correlationId = createLedgerlyAiCorrelationId("laim");
    const result = await memory.setStatus(c.get("principal"), c.req.param("id"), "active", correlationId, body.reason);
    return c.json({ data: result, correlationId });
  });

  routes.delete("/:id", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { reason?: string };
    const correlationId = createLedgerlyAiCorrelationId("laim");
    await memory.setStatus(c.get("principal"), c.req.param("id"), "deleted", correlationId, body.reason);
    return c.body(null, 204);
  });

  return routes;
}

export function createLedgerlyAiMemoryAdminRoutes(memory: LedgerlyAiMemoryService) {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const parsed = z.object({
      scopeType: z.enum(LEDGERLY_AI_MEMORY_SCOPES).optional(),
      status: z.enum(["active","expired","deleted"]).optional(),
      query: z.string().max(1500).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }).safeParse({
      scopeType: c.req.query("scopeType"),
      status: c.req.query("status"),
      query: c.req.query("query"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid memory inspector query.", parsed.error.flatten());
    return c.json({ data: await memory.adminList(c.get("principal"), parsed.data) });
  });

  routes.get("/audit", async (c) => {
    const parsed = z.object({
      memoryId: z.string().max(160).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }).safeParse({ memoryId: c.req.query("memoryId"), limit: c.req.query("limit") });
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid memory audit query.", parsed.error.flatten());
    return c.json({ data: await memory.adminAudit(c.get("principal"), parsed.data.memoryId, parsed.data.limit) });
  });

  return routes;
}
