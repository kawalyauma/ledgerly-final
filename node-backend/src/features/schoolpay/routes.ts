import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { requireScope } from "../core-identity/security.js";
import { captureSchoolPayWebhook, configureSchoolPay, listSchoolPayEvents, schoolPayConfigSummary } from "./service.js";

const configInput = z.object({
  schoolCode: z.string().min(1).max(120),
  apiPassword: z.string().min(1).max(500),
  bankAccountId: z.string().min(1),
  controlAccountId: z.string().min(1),
  enabled: z.boolean().default(true),
  autoAllocate: z.boolean().default(true),
});

const feePayment = z.object({
  amount: z.union([z.string(), z.number()]),
  paymentDateAndTime: z.string().min(1),
  schoolpayReceiptNumber: z.string().min(1).max(250),
  sourceChannelTransactionId: z.string().nullable().optional(),
  sourcePaymentChannel: z.string().nullable().optional(),
  studentPaymentCode: z.string().min(1).max(250),
  studentName: z.string().nullable().optional(),
  studentRegistrationNumber: z.string().nullable().optional(),
  transactionCompletionStatus: z.string().nullable().optional(),
}).passthrough();

const webhookInput = z.object({
  signature: z.string().min(1),
  type: z.string().min(1),
  payment: feePayment,
}).passthrough();

export function createSchoolPayAdminRoutes(runtime: Runtime) {
  const routes = new Hono<AppEnv>();
  routes.use("*", requireScope("school:read"));

  routes.get("/config", async (c) => {
    const principal = c.get("principal");
    return c.json({ data: await schoolPayConfigSummary(runtime, principal.organizationId) });
  });

  routes.put("/config", requireScope("school:write"), async (c) => {
    const parsed = configInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid SchoolPay configuration", parsed.error.flatten());
    const principal = c.get("principal");
    const configured = await configureSchoolPay(runtime, principal.organizationId, principal.userId, parsed.data);
    return c.json({ data: configured });
  });

  routes.get("/events", async (c) => {
    const principal = c.get("principal");
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json({ data: await listSchoolPayEvents(runtime, principal.organizationId, limit) });
  });

  return routes;
}

export function createSchoolPayWebhookRoutes(runtime: Runtime) {
  const routes = new Hono<AppEnv>();
  routes.post("/:webhookKey", async (c) => {
    const parsed = webhookInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "INVALID_SCHOOLPAY_WEBHOOK", "Invalid SchoolPay webhook payload", parsed.error.flatten());
    const result = await captureSchoolPayWebhook(runtime, c.req.param("webhookKey"), parsed.data);
    return c.json({ data: result }, 200);
  });
  return routes;
}
