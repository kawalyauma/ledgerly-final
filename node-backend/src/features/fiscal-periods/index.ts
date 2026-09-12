import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createFiscalPeriodRoutes, createFiscalYearRoutes } from "./routes.js";
import { assertPostingDateOpen } from "./service.js";

export const fiscalPeriodsFeature: BackendFeature = {
  key: "fiscal-periods",
  version: "1.0.0",
  mount(app, runtime) {
    const auth = requireAuth(runtime);

    // Register posting controls before finance routes so HTTP callers get a friendly 409.
    // PostgreSQL also enforces the same rule for internal/non-HTTP journal posting.
    app.use("/api/v1/journals/:id/post", auth, async (c, next) => {
      const row = (await runtime.db.query<{ postingDate: string }>(`SELECT posting_date::text AS "postingDate" FROM journal_entries WHERE id=$1 AND organization_id=$2`, [c.req.param("id"), c.get("principal").organizationId])).rows[0];
      if (row) await assertPostingDateOpen(runtime.db, c.get("principal").organizationId, row.postingDate);
      await next();
    });
    app.use("/api/v1/journals/:id/reverse", auth, async (c, next) => {
      const body = await c.req.raw.clone().json().catch(() => ({})) as { postingDate?: unknown };
      if (typeof body.postingDate === "string") await assertPostingDateOpen(runtime.db, c.get("principal").organizationId, body.postingDate);
      await next();
    });
    app.use("/api/v1/accounts/opening-balances", auth, async (c, next) => {
      const body = await c.req.raw.clone().json().catch(() => ({})) as { postingDate?: unknown };
      if (typeof body.postingDate === "string") await assertPostingDateOpen(runtime.db, c.get("principal").organizationId, body.postingDate);
      await next();
    });

    app.use("/api/v1/fiscal-years", auth);
    app.use("/api/v1/fiscal-years/*", auth);
    app.use("/api/v1/periods", auth);
    app.use("/api/v1/periods/*", auth);
    app.route("/api/v1/fiscal-years", createFiscalYearRoutes(runtime));
    app.route("/api/v1/periods", createFiscalPeriodRoutes(runtime));
  },
};
