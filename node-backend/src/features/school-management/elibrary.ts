import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
import { ulibtech } from "./ulibtech.js";

const slug = z.string().trim().min(1).max(240).regex(/^[a-z0-9][a-z0-9-]*$/i);
const searchSchema = z.object({
  q: z.string().max(200).optional(),
  class: slug.optional(), subject: slug.optional(), type: slug.optional(), term: slug.optional(), level: slug.optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});
const shelfSchema = z.object({
  slug,
  classId: z.string().max(160).nullable().optional(),
  subjectId: z.string().max(160).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

const shelfColumns = `id,resource_slug AS "slug",title,resource_type AS "type",class_name AS "className",subject_name AS "subject",term_name AS "term",
  page_count AS "pageCount",thumbnail_url AS "thumbnailUrl",class_id AS "classId",subject_id AS "subjectId",note,created_at AS "createdAt"`;

/** School e-library backed by the ULibTech (notesug.com) public library, plus a per-school shelf of saved resources. */
export function createElibraryRoutes(runtime: Runtime) {
  const routes = new Hono<AppEnv>();
  const library = ulibtech(runtime);

  routes.get("/status", requireScope("school:read"), c => c.json({ data: { source: "ULibTech", baseUrl: library.baseUrl, fullTextForAi: library.textEnabled } }));

  routes.get("/taxonomy", requireScope("school:read"), async c => c.json({ data: await library.taxonomy() }));

  routes.get("/resources", requireScope("school:read"), async c => {
    const parsed = searchSchema.safeParse(c.req.query());
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Check the e-library filters", parsed.error.flatten());
    const result = await library.search(parsed.data);
    const p = c.get("principal");
    const saved = result.items.length ? await runtime.db.query<{ slug: string }>(
      `SELECT resource_slug AS slug FROM school_elibrary_shelf WHERE organization_id=$1 AND resource_slug=ANY($2::text[])`,
      [p.organizationId, result.items.map((item: { slug: string }) => item.slug)],
    ) : { rows: [] };
    const savedSet = new Set(saved.rows.map(row => row.slug));
    return c.json({ data: { ...result, items: result.items.map((item: { slug: string }) => ({ ...item, saved: savedSet.has(item.slug) })) } });
  });

  routes.get("/resources/:slug", requireScope("school:read"), async c => {
    const parsed = slug.safeParse(c.req.param("slug"));
    if (!parsed.success) throw new AppError(404, "ELIBRARY_RESOURCE_NOT_FOUND", "Resource not found");
    return c.json({ data: await library.resource(parsed.data) });
  });

  routes.get("/shelf", requireScope("school:read"), async c => {
    const p = c.get("principal");
    const rows = await runtime.db.query(`SELECT ${shelfColumns} FROM school_elibrary_shelf WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 500`, [p.organizationId]);
    return c.json({ data: rows.rows.map(row => ({ ...row, ...library.links(String((row as { slug: string }).slug)) })) });
  });

  routes.post("/shelf", requireScope("school:write"), async c => {
    const parsed = shelfSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Check the shelf entry", parsed.error.flatten());
    const p = c.get("principal"), v = parsed.data;
    for (const [table, id] of [["school_classes", v.classId], ["school_subjects", v.subjectId]] as const) {
      if (id && !(await runtime.db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2`, [id, p.organizationId])).rowCount)
        throw new AppError(404, "NOT_FOUND", "Class or subject not found in this school");
    }
    // Snapshot the catalogue details so the shelf still reads well if ULibTech is briefly unreachable.
    const r = await library.resource(v.slug);
    const row = await runtime.db.query(`INSERT INTO school_elibrary_shelf(id,organization_id,resource_slug,title,resource_type,class_name,subject_name,term_name,page_count,thumbnail_url,class_id,subject_id,note,saved_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(organization_id,resource_slug) DO UPDATE SET title=EXCLUDED.title,class_id=COALESCE(EXCLUDED.class_id,school_elibrary_shelf.class_id),
        subject_id=COALESCE(EXCLUDED.subject_id,school_elibrary_shelf.subject_id),note=COALESCE(EXCLUDED.note,school_elibrary_shelf.note)
      RETURNING ${shelfColumns}`,
      [createId("elib"), p.organizationId, r.slug, r.title, r.type, r.className, r.subject, r.term, r.pageCount, r.thumbnailUrl, v.classId ?? null, v.subjectId ?? null, v.note ?? null, p.userId]);
    return c.json({ data: { ...row.rows[0], ...library.links(r.slug) } }, 201);
  });

  routes.delete("/shelf/:id", requireScope("school:write"), async c => {
    const p = c.get("principal");
    const result = await runtime.db.query("DELETE FROM school_elibrary_shelf WHERE id=$1 AND organization_id=$2", [c.req.param("id"), p.organizationId]);
    if (!result.rowCount) throw new AppError(404, "NOT_FOUND", "Shelf entry not found");
    return c.json({ data: { id: c.req.param("id") } });
  });

  return routes;
}
