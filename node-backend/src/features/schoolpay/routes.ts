import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { requireScope } from "../core-identity/security.js";
import { initiateSchoolPayAdhoc, listSchoolPayAdhocIntents } from "./adhoc.js";
import { getSchoolPayDiagnostics } from "./diagnostics.js";
import { listSchoolPayReconciliations, reconcileSchoolPayTransactions } from "./reconciliation.js";
import {
  captureSchoolPayAdhocCallbackLocked,
  recoverPendingSchoolPayAdhoc,
  refreshSchoolPayAdhocStatusLocked,
} from "./recovery.js";
import {
  enforceSchoolPayWebhookNetwork,
  listSchoolPaySecurityAudit,
  recordSchoolPaySecurityAudit,
} from "./security.js";
import {
  captureSchoolPayWebhook,
  configureSchoolPay,
  listSchoolPayEvents,
  retrySchoolPayEvent,
  schoolPayConfigSummary,
} from "./service.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.union([z.string().min(1), z.number().positive()]);
const configInput = z.object({
  schoolCode: z.string().min(1).max(120),
  apiPassword: z.string().min(1).max(500),
  bankAccountId: z.string().min(1),
  controlAccountId: z.string().min(1),
  importStartDate: date,
  enabled: z.boolean().default(true),
  autoAllocate: z.boolean().default(true),
});
const reconcileInput = z.object({ fromDate: date, toDate: date.optional() });
const adhocBaseInput = z.object({
  studentPaymentCode: z.string().min(1).max(250),
  externalReference: z.string().min(1).max(250),
  amount: money,
  reason: z.string().min(1).max(500),
  eventType: z.enum(["SCHOOL_FEES", "OTHER_FEES"]).default("SCHOOL_FEES"),
});
const adhocRequestInput = adhocBaseInput.extend({ phoneNumber: z.string().min(7).max(30) });

const feePayment = z.object({
  amount: money,
  paymentDateAndTime: z.string().min(1),
  schoolpayReceiptNumber: z.string().min(1).max(250),
  sourceChannelTransactionId: z.string().nullable().optional(),
  sourcePaymentChannel: z.string().nullable().optional(),
  studentPaymentCode: z.string().min(1).max(250),
  studentName: z.string().nullable().optional(),
  studentRegistrationNumber: z.string().nullable().optional(),
  transactionCompletionStatus: z.string().nullable().optional(),
  supplementaryFeeDescription: z.string().nullable().optional(),
  supplementaryFeeId: z.string().nullable().optional(),
}).passthrough();

const webhookInput = z.object({
  signature: z.string().min(1),
  type: z.enum(["SCHOOL_FEES", "OTHER_FEES"]),
  payment: feePayment,
}).passthrough();

const adhocCallbackInput = z.object({
  amount: money,
  channelName: z.string().nullable().optional(),
  paymentReference: z.string().min(1).max(250),
  receiptNumber: z.string().nullable().optional(),
  status: z.string().min(1).max(80),
  transactionId: z.string().nullable().optional(),
  returnCode: z.union([z.string(), z.number()]),
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

  routes.get("/health", async (c) => {
    const principal = c.get("principal");
    return c.json({ data: await getSchoolPayDiagnostics(runtime, principal.organizationId) });
  });

  routes.get("/diagnostics", async (c) => {
    const principal = c.get("principal");
    return c.json({ data: await getSchoolPayDiagnostics(runtime, principal.organizationId) });
  });

  routes.get("/security-audit", async (c) => {
    const principal = c.get("principal");
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json({ data: await listSchoolPaySecurityAudit(runtime, principal.organizationId, limit) });
  });

  routes.get("/events", async (c) => {
    const principal = c.get("principal");
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json({ data: await listSchoolPayEvents(runtime, principal.organizationId, limit) });
  });

  routes.post("/events/:eventId/retry", requireScope("school:write"), async (c) => {
    const principal = c.get("principal");
    const result = await retrySchoolPayEvent(runtime, principal.organizationId, c.req.param("eventId"));
    return c.json({ data: result });
  });

  routes.post("/reconcile", requireScope("school:write"), async (c) => {
    const parsed = reconcileInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid SchoolPay reconciliation request", parsed.error.flatten());
    const principal = c.get("principal");
    const result = await reconcileSchoolPayTransactions(
      runtime, principal.organizationId, principal.userId, parsed.data.fromDate, parsed.data.toDate ?? parsed.data.fromDate,
    );
    return c.json({ data: result }, 201);
  });

  routes.get("/reconciliations", async (c) => {
    const principal = c.get("principal");
    const limit = Number(c.req.query("limit") ?? 50);
    return c.json({ data: await listSchoolPayReconciliations(runtime, principal.organizationId, limit) });
  });

  routes.get("/adhoc", async (c) => {
    const principal = c.get("principal");
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json({ data: await listSchoolPayAdhocIntents(runtime, principal.organizationId, limit) });
  });

  routes.post("/adhoc/recover", requireScope("school:write"), async (c) => {
    const principal = c.get("principal");
    const result = await recoverPendingSchoolPayAdhoc(runtime, { organizationId: principal.organizationId, limit: 100, force: true });
    return c.json({ data: result });
  });

  routes.post("/adhoc/register", requireScope("school:write"), async (c) => {
    const parsed = adhocBaseInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid SchoolPay ad-hoc register request", parsed.error.flatten());
    const principal = c.get("principal");
    const result = await initiateSchoolPayAdhoc(runtime, principal.organizationId, principal.userId, { ...parsed.data, method: "register" });
    return c.json({ data: result }, result.duplicate ? 200 : 201);
  });

  routes.post("/adhoc/request", requireScope("school:write"), async (c) => {
    const parsed = adhocRequestInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid SchoolPay instant debit request", parsed.error.flatten());
    const principal = c.get("principal");
    const result = await initiateSchoolPayAdhoc(runtime, principal.organizationId, principal.userId, { ...parsed.data, method: "request" });
    return c.json({ data: result }, result.duplicate ? 200 : 201);
  });

  routes.get("/adhoc/:paymentReference/status", requireScope("school:write"), async (c) => {
    const principal = c.get("principal");
    const result = await refreshSchoolPayAdhocStatusLocked(runtime, principal.organizationId, c.req.param("paymentReference"));
    return c.json({ data: result });
  });

  return routes;
}

export function createSchoolPayWebhookRoutes(runtime: Runtime) {
  const routes = new Hono<AppEnv>();

  routes.post("/:webhookKey/adhoc", async (c) => {
    const webhookKey = c.req.param("webhookKey");
    const network = await enforceSchoolPayWebhookNetwork(runtime, c, webhookKey, "adhoc_callback");
    const parsed = adhocCallbackInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      await recordSchoolPaySecurityAudit(runtime, { webhookKey, endpointType: "adhoc_callback", outcome: "invalid_payload", ...network, reason: "Payload validation failed" });
      throw new AppError(422, "INVALID_SCHOOLPAY_ADHOC_CALLBACK", "Invalid SchoolPay ad-hoc callback payload", parsed.error.flatten());
    }
    try {
      const result = await captureSchoolPayAdhocCallbackLocked(runtime, webhookKey, parsed.data);
      await recordSchoolPaySecurityAudit(runtime, { webhookKey, endpointType: "adhoc_callback", outcome: "processed", ...network, identifier: parsed.data.paymentReference });
      return c.json({ data: result }, 200);
    } catch (error) {
      await recordSchoolPaySecurityAudit(runtime, { webhookKey, endpointType: "adhoc_callback", outcome: "failed", ...network, identifier: parsed.data.paymentReference, reason: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });

  routes.post("/:webhookKey", async (c) => {
    const webhookKey = c.req.param("webhookKey");
    const network = await enforceSchoolPayWebhookNetwork(runtime, c, webhookKey, "fees_webhook");
    const parsed = webhookInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      await recordSchoolPaySecurityAudit(runtime, { webhookKey, endpointType: "fees_webhook", outcome: "invalid_payload", ...network, reason: "Payload validation failed" });
      throw new AppError(422, "INVALID_SCHOOLPAY_WEBHOOK", "Invalid SchoolPay webhook payload", parsed.error.flatten());
    }
    try {
      const result = await captureSchoolPayWebhook(runtime, webhookKey, parsed.data);
      await recordSchoolPaySecurityAudit(runtime, { webhookKey, endpointType: "fees_webhook", outcome: "processed", ...network, identifier: parsed.data.payment.schoolpayReceiptNumber });
      return c.json({ data: result }, 200);
    } catch (error) {
      await recordSchoolPaySecurityAudit(runtime, { webhookKey, endpointType: "fees_webhook", outcome: "failed", ...network, identifier: parsed.data.payment.schoolpayReceiptNumber, reason: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });
  return routes;
}
