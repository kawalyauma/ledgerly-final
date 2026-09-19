import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { requireAuth } from "./features/core-identity/security.js";
import type { BackendFeature } from "./features/types.js";
import type { HealthChecker } from "./health/service.js";
import { AppError, isPgError } from "./http/errors.js";
import type { AppEnv } from "./http/types.js";
import type { Runtime } from "./runtime.js";
import { getLedgerlyAiFoundationService } from "./features/ledgerly-ai/runtime-service.js";

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500;

export function createApp(options: {
  environment: string;
  corsOrigins: string[];
  health: HealthChecker;
  features?: BackendFeature[];
  runtime?: Runtime;
}) {
  const app = new Hono<AppEnv>();
  const captureIncident = (input: {
    organizationId?: string | null;
    source: string;
    signalType: "http" | "exception" | "queue" | "health" | "manual";
    message: string;
    title?: string;
    code?: string | null;
    httpStatus?: number | null;
    path?: string | null;
    method?: string | null;
    correlationId?: string | null;
    stack?: string | null;
    context?: Record<string, unknown>;
  }) => {
    if (!options.runtime) return;
    void getLedgerlyAiFoundationService(options.runtime).incidents.signal(input).catch((incidentError) => {
      options.runtime?.logger.warn(
        { err: incidentError instanceof Error ? incidentError.message : String(incidentError), source: input.source },
        "Ledgerly AI incident capture failed",
      );
    });
  };
  app.use("*", requestId());
  app.use("*", secureHeaders());
  app.use("*", async (c, next) => {
    await next();
    const status = c.res.status;
    if (status < 400 || c.get("incidentCaptured")) return;
    let organizationId: string | null = null;
    try { organizationId = c.get("principal")?.organizationId ?? null; } catch {}
    c.set("incidentCaptured", true);
    captureIncident({
      organizationId,
      source: "api-response",
      signalType: "http",
      message: `HTTP ${status} response`,
      code: `HTTP_${status}`,
      httpStatus: status,
      path: c.req.path,
      method: c.req.method,
      correlationId: c.get("requestId"),
    });
  });
  const corsConfig = {
    origin: options.corsOrigins.includes("*") ? "*" : options.corsOrigins,
    allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-API-Key", "X-Organization-Id", "X-User-Id", "X-Request-Id", "X-Printerly-Claim"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  };
  app.use("/api/*", cors(corsConfig));
  app.use("/auth/*", cors(corsConfig));

  if (options.runtime) {
    const auth = requireAuth(options.runtime);
    app.use("/api/v1/*", async (c, next) => {
      const mobileOffline = c.req.path === "/api/v1/mobile-sync/offline" || c.req.path.startsWith("/api/v1/mobile-sync/offline/");
      const printerlyNode = c.req.path.startsWith("/api/v1/printerly/node/");
      const nvrDevice = c.req.path.startsWith("/api/v1/nvr/device/");
      if (mobileOffline || printerlyNode || nvrDevice) {
        await next();
        return;
      }
      await auth(c, next);
    });
  }

  const activeFeatures = options.features ?? [];
  app.get("/", (c) => c.json({
    name: "Ledgerly Node API",
    runtime: "node",
    stage: activeFeatures.length ? "feature-migration" : "foundation",
    apiVersion: "v1",
    features: activeFeatures.map((feature) => ({ key: feature.key, version: feature.version })),
  }));
  app.get("/system/live", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));
  app.get("/system/health", async (c) => {
    const health = await options.health.check();
    if (health.status !== "ok") {
      c.set("incidentCaptured", true);
      captureIncident({
        organizationId: null,
        source: "platform-health",
        signalType: "health",
        message: "Ledgerly platform health is degraded.",
        title: "Platform health degraded",
        code: "PLATFORM_HEALTH_DEGRADED",
        httpStatus: 503,
        path: c.req.path,
        method: c.req.method,
        correlationId: c.get("requestId"),
        context: { components: health.components },
      });
    }
    return c.json(health, health.status === "ok" ? 200 : 503);
  });

  for (const feature of activeFeatures) {
    if (!feature.mount) continue;
    if (!options.runtime) throw new Error(`Runtime is required to mount feature ${feature.key}`);
    feature.mount(app, options.runtime);
  }

  app.notFound((c) => {
    let organizationId: string | null = null;
    try { organizationId = c.get("principal")?.organizationId ?? null; } catch {}
    c.set("incidentCaptured", true);
    captureIncident({
      organizationId,
      source: "api",
      signalType: "http",
      message: "Route not found",
      code: "NOT_FOUND",
      httpStatus: 404,
      path: c.req.path,
      method: c.req.method,
      correlationId: c.get("requestId"),
    });
    return c.json({ error: { code: "NOT_FOUND", message: "Route not found", requestId: c.get("requestId") } }, 404);
  });
  app.onError((error, c) => {
    const requestId = c.get("requestId");
    console.error(JSON.stringify({ level: "error", requestId, message: error.message, stack: error.stack }));
    let organizationId: string | null = null;
    try { organizationId = c.get("principal")?.organizationId ?? null; } catch {}
    c.set("incidentCaptured", true);
    let incidentStatus = 500;
    let incidentCode = "INTERNAL_ERROR";
    if (error instanceof AppError) {
      incidentStatus = error.status;
      incidentCode = error.code;
    } else if (isPgError(error) && error.code === "23505") {
      incidentStatus = 409; incidentCode = "DUPLICATE_RECORD";
    } else if (isPgError(error) && error.code === "23503") {
      incidentStatus = 409; incidentCode = "RELATED_RECORD_CONFLICT";
    } else if (isPgError(error) && error.code === "P0001") {
      incidentStatus = 409; incidentCode = "DATABASE_INVARIANT";
    }
    captureIncident({
      organizationId,
      source: "api",
      signalType: incidentStatus >= 500 ? "exception" : "http",
      message: error.message,
      code: incidentCode,
      httpStatus: incidentStatus,
      path: c.req.path,
      method: c.req.method,
      correlationId: requestId,
      stack: error.stack,
      context: error instanceof AppError ? { details: error.details } : {
        pgCode: isPgError(error) ? error.code ?? null : null,
        pgConstraint: isPgError(error) ? error.constraint ?? null : null,
      },
    });
    if (error instanceof AppError) {
      return c.json({ error: { code: error.code, message: error.message, details: error.details, requestId } }, error.status as ErrorStatus);
    }
    if (isPgError(error) && error.code === "P0001") {
      const fiscalMatch = /^(FISCAL_(?:YEAR|PERIOD)_CLOSED):(.+):([^:]+)$/.exec(error.message);
      if (fiscalMatch) {
        const code = fiscalMatch[1] as "FISCAL_YEAR_CLOSED" | "FISCAL_PERIOD_CLOSED";
        const label = code === "FISCAL_YEAR_CLOSED" ? "Financial year" : "Fiscal period";
        return c.json({ error: { code, message: `${label} ${fiscalMatch[2]} is ${fiscalMatch[3]}`, requestId } }, 409);
      }
      const invariant = /^([A-Z][A-Z0-9_]+):(.+)$/.exec(error.message);
      if (invariant) {
        const code = invariant[1]!;
        const entityId = invariant[2]!;
        const validationMessages: Record<string, string> = {
          INVALID_ALLOCATION_DOCUMENT: "Allocation document is not open or does not match the payment.",
          PAYMENT_OVER_ALLOCATION: "Allocations exceed the payment amount.",
          DOCUMENT_OVER_ALLOCATION: "Allocation exceeds the document outstanding balance.",
          BANK_MATCH_LINE_INVALID: "A posted journal line is required for bank matching.",
          BANK_MATCH_ACCOUNT_MISMATCH: "The journal line does not belong to the selected bank ledger account.",
          BANK_MATCH_CURRENCY_MISMATCH: "The journal line currency does not match the bank account currency.",
          BANK_MATCH_AMOUNT_MISMATCH: "The journal line signed amount does not match the bank transaction.",
        };
        const conflictMessages: Record<string, string> = {
          PAYMENT_NOT_POSTED: "Allocations can only be added to a posted payment.",
          PAYMENT_JOURNAL_REQUIRED: "A posted payment requires an accounting journal.",
          PAYMENT_JOURNAL_NOT_POSTED: "The payment accounting journal must be posted first.",
          PAYMENT_REVERSAL_JOURNAL_REQUIRED: "A reversed payment requires a posted reversal journal.",
          PAYMENT_ORIGINAL_JOURNAL_NOT_REVERSED: "The original payment journal must be reversed first.",
          PAYMENT_ALLOCATIONS_STILL_ACTIVE: "Payment allocations must be reversed before the payment can be reversed.",
          DOCUMENT_JOURNAL_REQUIRED: "A posted document requires an accounting journal.",
          DOCUMENT_JOURNAL_NOT_POSTED: "The document accounting journal must be posted first.",
          DOCUMENT_JOURNAL_NOT_REVERSED: "The document accounting journal must be reversed before voiding the document.",
          BANK_MATCH_STATE_INVALID: "Bank transaction match state is inconsistent.",
          BANK_MATCH_REQUIRED: "Matched and reconciled bank transactions require a journal line.",
          BANK_RECONCILIATION_REQUIRED: "A reconciled bank transaction requires a reconciliation record.",
          RECONCILIATION_DIFFERENCE: "A reconciliation can only complete at zero difference.",
          RECONCILIATION_UNMATCHED_TRANSACTIONS: "All statement transactions must be matched before reconciliation can complete.",
        };
        if (validationMessages[code]) return c.json({ error: { code, message: validationMessages[code], details: { entityId }, requestId } }, 422);
        if (conflictMessages[code]) return c.json({ error: { code, message: conflictMessages[code], details: { entityId }, requestId } }, 409);
      }
    }
    if (isPgError(error) && error.code === "23505") {
      return c.json({ error: { code: "DUPLICATE_RECORD", message: "A record with the same unique value already exists.", requestId } }, 409);
    }
    if (isPgError(error) && error.code === "23503") {
      return c.json({ error: { code: "RELATED_RECORD_CONFLICT", message: "This change conflicts with related records.", requestId } }, 409);
    }
    return c.json({ error: { code: "INTERNAL_ERROR", message: options.environment === "development" ? error.message : "The request could not be completed.", requestId } }, 500);
  });
  return app;
}
