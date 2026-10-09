import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rosterSchema = z.object({
  staffId: z.string().min(1),
  dutyRole: z.string().trim().min(1).max(80).default("Teacher on duty"),
  startsOn: day,
  endsOn: day,
  notes: z.string().max(500).nullable().optional(),
}).refine(v => v.endsOn >= v.startsOn, { message: "End date must be on or after the start date", path: ["endsOn"] });

const columns = `r.id,r.staff_id AS "staffId",r.duty_role AS "dutyRole",r.starts_on::text AS "startsOn",r.ends_on::text AS "endsOn",r.notes,
  concat_ws(' ',COALESCE(NULLIF(s.preferred_name,''),s.first_name),s.last_name) AS "staffName"`;

/** Teacher-on-duty roster maintained by school admins and shown on the kiosk. */
export function createSchoolDutyRoutes(runtime: Runtime) {
  const routes = new Hono<AppEnv>();

  routes.get("/", requireScope("school:read"), async c => {
    const p = c.get("principal");
    const from = c.req.query("from"), to = c.req.query("to");
    const result = await runtime.db.query(`SELECT ${columns} FROM school_duty_rosters r JOIN school_staff_profiles s ON s.id=r.staff_id
      WHERE r.organization_id=$1 AND r.ends_on>=COALESCE($2::date,CURRENT_DATE-30) AND r.starts_on<=COALESCE($3::date,CURRENT_DATE+120)
      ORDER BY r.starts_on,r.duty_role`, [p.organizationId, day.safeParse(from).success ? from : null, day.safeParse(to).success ? to : null]);
    return c.json({ data: result.rows });
  });

  routes.post("/", requireScope("school:write"), async c => {
    const parsed = rosterSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Check the duty roster entry", parsed.error.flatten());
    const p = c.get("principal"), v = parsed.data;
    const staff = await runtime.db.query("SELECT 1 FROM school_staff_profiles WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL", [v.staffId, p.organizationId]);
    if (!staff.rowCount) throw new AppError(404, "STAFF_NOT_FOUND", "Staff member not found");
    const id = createId("duty");
    await runtime.db.query(`INSERT INTO school_duty_rosters(id,organization_id,staff_id,duty_role,starts_on,ends_on,notes,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [id, p.organizationId, v.staffId, v.dutyRole, v.startsOn, v.endsOn, v.notes ?? null, p.userId]);
    const row = await runtime.db.query(`SELECT ${columns} FROM school_duty_rosters r JOIN school_staff_profiles s ON s.id=r.staff_id WHERE r.id=$1`, [id]);
    return c.json({ data: row.rows[0] }, 201);
  });

  routes.delete("/:id", requireScope("school:write"), async c => {
    const p = c.get("principal");
    const result = await runtime.db.query("DELETE FROM school_duty_rosters WHERE id=$1 AND organization_id=$2", [c.req.param("id"), p.organizationId]);
    if (!result.rowCount) throw new AppError(404, "DUTY_NOT_FOUND", "Duty roster entry not found");
    return c.json({ data: { id: c.req.param("id") } });
  });

  return routes;
}
