import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import { createLedgerlyAiCorrelationId } from "../logger.js";
import type { LedgerlyAiEmployeeRegistry } from "../employees/registry.js";
import type { LedgerlyAiToolService } from "./service.js";

export function createLedgerlyAiToolRoutes(
  tools: LedgerlyAiToolService,
  employees: LedgerlyAiEmployeeRegistry,
) {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const principal = c.get("principal");
    const agentId = c.req.query("agentId");
    const employee = agentId ? await employees.resolveSelectable(principal, agentId) : null;
    return c.json({ data: tools.catalog(principal, employee) });
  });

  routes.post("/:name/invoke", async (c) => {
    const parsed = z.object({
      arguments: z.record(z.string(), z.unknown()).default({}),
      agentId: z.string().min(1).max(160).nullable().optional(),
    }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError(422, "VALIDATION_ERROR", "Invalid Ledgerly AI tool invocation.", parsed.error.flatten());
    }
    const principal = c.get("principal");
    const employee = parsed.data.agentId
      ? await employees.resolveSelectable(principal, parsed.data.agentId)
      : null;
    const correlationId = createLedgerlyAiCorrelationId("lait");
    const result = await tools.invoke({
      principal,
      employee,
      toolName: c.req.param("name"),
      arguments: parsed.data.arguments,
      correlationId,
    });
    return c.json({ data: result, correlationId }, result.status === "waiting_approval" ? 202 : 200);
  });

  routes.get("/calls/:id", async (c) => {
    return c.json({ data: await tools.toolCall(c.get("principal"), c.req.param("id")) });
  });

  return routes;
}

export function createLedgerlyAiApprovalRoutes(tools: LedgerlyAiToolService) {
  const routes = new Hono<AppEnv>();

  routes.get("/", async (c) => {
    const parsed = z.enum(["pending","approved","rejected","cancelled","executed","failed"])
      .default("pending")
      .safeParse(c.req.query("status") ?? "pending");
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid approval status.");
    return c.json({ data: await tools.listApprovals(c.get("principal"), parsed.data) });
  });

  routes.post("/:id/approve", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({ note: z.string().trim().max(2000).optional() }).safeParse(body);
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid approval review.", parsed.error.flatten());
    return c.json({ data: await tools.approve(c.get("principal"), c.req.param("id"), parsed.data.note) });
  });

  routes.post("/:id/reject", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z.object({ note: z.string().trim().max(2000).optional() }).safeParse(body);
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid approval review.", parsed.error.flatten());
    return c.json({ data: await tools.reject(c.get("principal"), c.req.param("id"), parsed.data.note) });
  });

  return routes;
}
