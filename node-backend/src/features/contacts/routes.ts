import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
import { auditContact, contactHasFinancialHistory, createAddress, createPerson, mergeContacts, requireContact } from "./service.js";

const contactInput = z.object({
  type: z.enum(["customer", "supplier", "employee", "other"]),
  code: z.string().trim().max(30).optional(),
  name: z.string().trim().min(1).max(160),
  email: z.email().optional(),
  taxNumber: z.string().trim().max(60).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  customFields: z.record(z.string(), z.unknown()).default({}),
  creditLimitMinor: z.number().int().nonnegative().default(0),
  pricingTier: z.string().trim().max(60).nullable().optional(),
  active: z.boolean().default(true),
});
const addressInput = z.object({
  type: z.enum(["billing", "shipping", "registered", "other"]),
  line1: z.string().trim().min(1).max(300),
  line2: z.string().trim().max(300).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  state: z.string().trim().max(120).optional().nullable(),
  postalCode: z.string().trim().max(40).optional().nullable(),
  country: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  isDefault: z.boolean().default(false),
});
const personInput = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.email().optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  role: z.string().trim().max(80).optional().nullable(),
  isPrimary: z.boolean().default(false),
});

function pagination(c: { req: { query: (name: string) => string | undefined } }) {
  const requestedLimit = Number(c.req.query("limit") ?? 50);
  const requestedOffset = Number(c.req.query("offset") ?? 0);
  return {
    limit: Number.isSafeInteger(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 50,
    offset: Number.isSafeInteger(requestedOffset) ? Math.max(0, requestedOffset) : 0,
  };
}

export function createContactsRoutes(runtime: Runtime) {
  const router = new Hono<AppEnv>();

  router.get("/capabilities", requireScope("contacts:read"), async (c) => c.json({ data: {
    enabledModules: [
      { key: "ledgerly-core", name: "Ledgerly Finance Core", category: "finance" },
      { key: "contacts", name: "Contacts", category: "shared" },
    ],
    sources: [{ moduleKey: "ledgerly-core", name: "Ledgerly Finance Core", groups: ["customer", "supplier", "employee", "other"], channels: [] }],
  } }));

  router.get("/people", requireScope("contacts:read"), async (c) => {
    const p = c.get("principal"), { limit, offset } = pagination(c);
    const source = c.req.query("source"), group = c.req.query("group"), channel = c.req.query("channel"), search = (c.req.query("search") ?? "").trim();
    if (source && source !== "ledgerly-core") return c.json({ data: [], pagination: { limit, offset, total: 0 } });
    if (channel) return c.json({ data: [], pagination: { limit, offset, total: 0 } });
    const params: unknown[] = [p.organizationId];
    const conditions = ["c.organization_id=$1", "c.archived_at IS NULL"];
    if (group) { params.push(group); conditions.push(`c.type=$${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(c.name ILIKE $${params.length} OR COALESCE(c.email,'') ILIKE $${params.length} OR COALESCE(c.code,'') ILIKE $${params.length} OR EXISTS (SELECT 1 FROM contact_people cp2 WHERE cp2.organization_id=c.organization_id AND cp2.contact_id=c.id AND COALESCE(cp2.phone,'') ILIKE $${params.length}))`); }
    const total = Number((await runtime.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM contacts c WHERE ${conditions.join(" AND ")}`, params)).rows[0]?.count ?? 0);
    params.push(limit, offset);
    const rows = await runtime.db.query<{ id:string; type:string; code:string|null; name:string; email:string|null; active:boolean; phone:string|null }>(
      `SELECT c.id,c.type,c.code,c.name,c.email,c.active,
        (SELECT cp.phone FROM contact_people cp WHERE cp.organization_id=c.organization_id AND cp.contact_id=c.id ORDER BY cp.is_primary DESC,cp.created_at LIMIT 1) AS phone
       FROM contacts c WHERE ${conditions.join(" AND ")} ORDER BY c.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return c.json({ data: rows.rows.map((row) => ({ id:`ledgerly-core:${row.id}`,entityId:row.id,contactId:row.id,sourceModule:"ledgerly-core",group:row.type,name:row.name,email:row.email,phone:row.phone,code:row.code,active:row.active })), pagination:{ limit,offset,total } });
  });

  router.get("/archived", requireScope("contacts:read"), async (c) => {
    const p = c.get("principal");
    const rows = await runtime.db.query(`SELECT id,type,code,name,email,archived_at AS "archivedAt" FROM contacts WHERE organization_id=$1 AND archived_at IS NOT NULL ORDER BY archived_at DESC,name`, [p.organizationId]);
    return c.json({ data: rows.rows });
  });

  router.get("/", requireScope("contacts:read"), async (c) => {
    const p = c.get("principal"), { limit, offset } = pagination(c), type = c.req.query("type"), search = (c.req.query("search") ?? "").trim();
    const params: unknown[] = [p.organizationId];
    const conditions = ["organization_id=$1", "archived_at IS NULL"];
    if (type) { params.push(type); conditions.push(`type=$${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(name ILIKE $${params.length} OR COALESCE(code,'') ILIKE $${params.length} OR COALESCE(email,'') ILIKE $${params.length})`); }
    params.push(limit, offset);
    const result = await runtime.db.query(
      `SELECT id,type,code,name,email,tax_number AS "taxNumber",payment_terms_days AS "paymentTermsDays",active,
        credit_limit_minor::float8 AS "creditLimitMinor",pricing_tier AS "pricingTier",custom_fields AS "customFields",created_at AS "createdAt"
       FROM contacts WHERE ${conditions.join(" AND ")} ORDER BY name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return c.json({ data: result.rows, pagination: { limit, offset } });
  });

  router.post("/", requireScope("contacts:write"), async (c) => {
    const parsed = contactInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid contact", parsed.error.flatten());
    const p = c.get("principal"), id = createId("con"), v = parsed.data;
    const client = await runtime.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO contacts(id,organization_id,type,code,name,email,tax_number,payment_terms_days,custom_fields,credit_limit_minor,pricing_tier,active)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
        [id,p.organizationId,v.type,v.code || null,v.name,v.email?.toLowerCase() ?? null,v.taxNumber || null,v.paymentTermsDays,JSON.stringify(v.customFields),v.creditLimitMinor,v.pricingTier ?? null,v.active],
      );
      await auditContact(client,p.organizationId,p.userId,"contact.created","contact",id,v);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return c.json({ data: { id, ...v, email: v.email?.toLowerCase() } }, 201);
  });

  router.get("/:id/detail", requireScope("contacts:read"), async (c) => {
    const p = c.get("principal"), id = c.req.param("id"), contact = await requireContact(runtime.db,p.organizationId,id,true);
    const [addresses, people] = await Promise.all([
      runtime.db.query(`SELECT id,type,line1,line2,city,state,postal_code AS "postalCode",country,is_default AS "isDefault",created_at AS "createdAt",updated_at AS "updatedAt" FROM contact_addresses WHERE organization_id=$1 AND contact_id=$2 ORDER BY is_default DESC,type,line1`,[p.organizationId,id]),
      runtime.db.query(`SELECT id,name,email,phone,role,is_primary AS "isPrimary",created_at AS "createdAt",updated_at AS "updatedAt" FROM contact_people WHERE organization_id=$1 AND contact_id=$2 ORDER BY is_primary DESC,name`,[p.organizationId,id]),
    ]);
    return c.json({ data: { contact, addresses: addresses.rows, people: people.rows } });
  });

  router.put("/:id", requireScope("contacts:write"), async (c) => {
    const parsed = contactInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid contact",parsed.error.flatten());
    const p=c.get("principal"), id=c.req.param("id"), v=parsed.data;
    const result=await runtime.db.query(
      `UPDATE contacts SET type=$1,code=$2,name=$3,email=$4,tax_number=$5,payment_terms_days=$6,custom_fields=$7::jsonb,
       credit_limit_minor=$8,pricing_tier=$9,active=$10,updated_at=CURRENT_TIMESTAMP WHERE id=$11 AND organization_id=$12 AND archived_at IS NULL`,
      [v.type,v.code || null,v.name,v.email?.toLowerCase() ?? null,v.taxNumber || null,v.paymentTermsDays,JSON.stringify(v.customFields),v.creditLimitMinor,v.pricingTier ?? null,v.active,id,p.organizationId],
    );
    if (!result.rowCount) throw new AppError(404,"NOT_FOUND","Contact not found");
    await auditContact(runtime.db,p.organizationId,p.userId,"contact.updated","contact",id,v);
    return c.json({ data:{id,...v,email:v.email?.toLowerCase()} });
  });

  router.delete("/:id", requireScope("contacts:write"), async (c) => {
    const p=c.get("principal"), id=c.req.param("id");
    await requireContact(runtime.db,p.organizationId,id,true);
    if (await contactHasFinancialHistory(runtime.db,p.organizationId,id)) throw new AppError(409,"CONTACT_IN_USE","Contact has financial history; archive it instead");
    await runtime.db.query("DELETE FROM contacts WHERE id=$1 AND organization_id=$2",[id,p.organizationId]);
    await auditContact(runtime.db,p.organizationId,p.userId,"contact.deleted","contact",id);
    return c.body(null,204);
  });

  router.post("/:id/archive", requireScope("contacts:write"), async (c) => {
    const p=c.get("principal"), id=c.req.param("id");
    const result=await runtime.db.query("UPDATE contacts SET active=false,archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL",[id,p.organizationId]);
    if (!result.rowCount) throw new AppError(404,"NOT_FOUND","Contact not found");
    await auditContact(runtime.db,p.organizationId,p.userId,"contact.archived","contact",id);
    return c.json({data:{id,status:"archived"}});
  });

  router.post("/:id/restore", requireScope("contacts:write"), async (c) => {
    const p=c.get("principal"), id=c.req.param("id");
    const result=await runtime.db.query("UPDATE contacts SET active=true,archived_at=NULL,merged_into_contact_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND archived_at IS NOT NULL",[id,p.organizationId]);
    if (!result.rowCount) throw new AppError(404,"NOT_FOUND","Archived contact not found");
    await auditContact(runtime.db,p.organizationId,p.userId,"contact.restored","contact",id);
    return c.json({data:{id,status:"active"}});
  });

  router.post("/:id/merge", requireScope("contacts:write"), async (c) => {
    const parsed=z.object({targetContactId:z.string().min(1)}).safeParse(await c.req.json().catch(()=>null));
    if (!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid merge target");
    const p=c.get("principal");
    return c.json({data:await mergeContacts(runtime,p.organizationId,p.userId,c.req.param("id"),parsed.data.targetContactId)});
  });

  router.get("/:id/addresses", requireScope("contacts:read"), async (c) => {
    const p=c.get("principal");
    const rows=await runtime.db.query(`SELECT id,type,line1,line2,city,state,postal_code AS "postalCode",country,is_default AS "isDefault" FROM contact_addresses WHERE organization_id=$1 AND contact_id=$2 ORDER BY is_default DESC,type,line1`,[p.organizationId,c.req.param("id")]);
    return c.json({data:rows.rows});
  });

  const addAddress = async (c: Parameters<Parameters<typeof router.post>[2]>[0]) => {
    const parsed=addressInput.safeParse(await c.req.json().catch(()=>null));
    if (!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid address",parsed.error.flatten());
    const p=c.get("principal");
    return c.json({data:await createAddress(runtime,p.organizationId,p.userId,c.req.param("id"),parsed.data)},201);
  };
  router.post("/:id/addresses",requireScope("contacts:write"),addAddress);
  router.post("/:id/addresses/manage",requireScope("contacts:write"),addAddress);

  router.patch("/:id/addresses/:addressId", requireScope("contacts:write"), async (c) => {
    const parsed=addressInput.partial().safeParse(await c.req.json().catch(()=>null));
    if (!parsed.success || !Object.keys(parsed.data).length) throw new AppError(422,"VALIDATION_ERROR","No valid address changes supplied",parsed.success?undefined:parsed.error.flatten());
    const p=c.get("principal"),contactId=c.req.param("id"),addressId=c.req.param("addressId"),client=await runtime.db.connect();
    try {
      await client.query("BEGIN");
      const current=(await client.query<any>(`SELECT type,line1,line2,city,state,postal_code AS "postalCode",country,is_default AS "isDefault" FROM contact_addresses WHERE id=$1 AND contact_id=$2 AND organization_id=$3 FOR UPDATE`,[addressId,contactId,p.organizationId])).rows[0];
      if (!current) throw new AppError(404,"NOT_FOUND","Contact address not found");
      const next={...current,...parsed.data};
      if (next.isDefault) await client.query("UPDATE contact_addresses SET is_default=false,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND contact_id=$2 AND type=$3 AND id<>$4",[p.organizationId,contactId,next.type,addressId]);
      await client.query(`UPDATE contact_addresses SET type=$1,line1=$2,line2=$3,city=$4,state=$5,postal_code=$6,country=$7,is_default=$8,updated_at=CURRENT_TIMESTAMP WHERE id=$9 AND contact_id=$10 AND organization_id=$11`,[next.type,next.line1,next.line2 ?? null,next.city ?? null,next.state ?? null,next.postalCode ?? null,String(next.country).toUpperCase(),Boolean(next.isDefault),addressId,contactId,p.organizationId]);
      await auditContact(client,p.organizationId,p.userId,"contact.address.updated","contact_address",addressId,{contactId,...parsed.data});
      await client.query("COMMIT");
      return c.json({data:{id:addressId,...next,country:String(next.country).toUpperCase(),isDefault:Boolean(next.isDefault)}});
    } catch(error){await client.query("ROLLBACK");throw error;} finally{client.release();}
  });

  router.delete("/:id/addresses/:addressId",requireScope("contacts:write"),async(c)=>{const p=c.get("principal"),r=await runtime.db.query("DELETE FROM contact_addresses WHERE id=$1 AND contact_id=$2 AND organization_id=$3",[c.req.param("addressId"),c.req.param("id"),p.organizationId]);if(!r.rowCount)throw new AppError(404,"NOT_FOUND","Contact address not found");return c.body(null,204);});

  const addPerson = async (c: Parameters<Parameters<typeof router.post>[2]>[0]) => {
    const parsed=personInput.safeParse(await c.req.json().catch(()=>null));
    if (!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid contact person",parsed.error.flatten());
    const p=c.get("principal");
    return c.json({data:await createPerson(runtime,p.organizationId,p.userId,c.req.param("id"),parsed.data)},201);
  };
  router.post("/:id/people",requireScope("contacts:write"),addPerson);
  router.post("/:id/people/manage",requireScope("contacts:write"),addPerson);

  router.patch("/:id/people/:personId",requireScope("contacts:write"),async(c)=>{const parsed=personInput.partial().safeParse(await c.req.json().catch(()=>null));if(!parsed.success||!Object.keys(parsed.data).length)throw new AppError(422,"VALIDATION_ERROR","No valid person changes supplied",parsed.success?undefined:parsed.error.flatten());const p=c.get("principal"),contactId=c.req.param("id"),personId=c.req.param("personId"),client=await runtime.db.connect();try{await client.query("BEGIN");const current=(await client.query<any>(`SELECT name,email,phone,role,is_primary AS "isPrimary" FROM contact_people WHERE id=$1 AND contact_id=$2 AND organization_id=$3 FOR UPDATE`,[personId,contactId,p.organizationId])).rows[0];if(!current)throw new AppError(404,"NOT_FOUND","Contact person not found");const next={...current,...parsed.data};if(next.isPrimary)await client.query("UPDATE contact_people SET is_primary=false,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND contact_id=$2 AND id<>$3",[p.organizationId,contactId,personId]);await client.query("UPDATE contact_people SET name=$1,email=$2,phone=$3,role=$4,is_primary=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$6 AND contact_id=$7 AND organization_id=$8",[next.name,next.email?.toLowerCase() ?? null,next.phone ?? null,next.role ?? null,Boolean(next.isPrimary),personId,contactId,p.organizationId]);await auditContact(client,p.organizationId,p.userId,"contact.person.updated","contact_person",personId,{contactId,...parsed.data});await client.query("COMMIT");return c.json({data:{id:personId,...next,email:next.email?.toLowerCase() ?? null,isPrimary:Boolean(next.isPrimary)}});}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}});
  router.delete("/:id/people/:personId",requireScope("contacts:write"),async(c)=>{const p=c.get("principal"),r=await runtime.db.query("DELETE FROM contact_people WHERE id=$1 AND contact_id=$2 AND organization_id=$3",[c.req.param("personId"),c.req.param("id"),p.organizationId]);if(!r.rowCount)throw new AppError(404,"NOT_FOUND","Contact person not found");return c.body(null,204);});

  return router;
}
