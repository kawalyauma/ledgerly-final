import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../src/lib/errors";
import { requireScope } from "../../../src/lib/auth";
import type { AppVariables, Env } from "../../../src/types";
import { loadEventSettings } from "./event-context";
import { processEventInbox } from "./event-processor";

export const agenticEventRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

agenticEventRoutes.get("/events/reactions",requireScope("school:read"),async c=>{
  const p=c.get("principal"),limit=Math.max(1,Math.min(100,Number(c.req.query("limit")||50)));
  const unacknowledged=c.req.query("unacknowledged")==="true";
  const rows=await c.env.FINANCE_DB.prepare(`SELECT r.id,r.event_id AS eventId,r.agent_key AS agentKey,r.severity,r.title,r.summary,
    r.recommended_action AS recommendedAction,r.model,r.metadata_json AS metadataJson,r.acknowledged_at AS acknowledgedAt,
    r.acknowledged_by AS acknowledgedBy,r.created_at AS createdAt,e.event_type AS eventType,e.source_module AS sourceModule,
    e.subject_type AS subjectType,e.subject_id AS subjectId,e.occurred_at AS occurredAt
    FROM ae_event_reactions r JOIN ae_event_inbox e ON e.id=r.event_id AND e.organization_id=r.organization_id
    WHERE r.organization_id=? AND (?=0 OR r.acknowledged_at IS NULL)
    ORDER BY CASE r.severity WHEN 'urgent' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END,r.created_at DESC LIMIT ?`)
    .bind(p.organizationId,unacknowledged?1:0,limit).all<any>();
  return c.json({data:rows.results.map(row=>({...row,metadata:safeJson(row.metadataJson),metadataJson:undefined}))});
});

agenticEventRoutes.get("/events/inbox",requireScope("school:write"),async c=>{
  const p=c.get("principal"),limit=Math.max(1,Math.min(100,Number(c.req.query("limit")||50)));
  const rows=await c.env.FINANCE_DB.prepare(`SELECT id,event_type AS eventType,source_module AS sourceModule,source_record_id AS sourceRecordId,
    subject_type AS subjectType,subject_id AS subjectId,status,attempts,occurred_at AS occurredAt,processed_at AS processedAt,error_text AS errorText
    FROM ae_event_inbox WHERE organization_id=? ORDER BY occurred_at DESC LIMIT ?`).bind(p.organizationId,limit).all();
  return c.json({data:rows.results});
});

agenticEventRoutes.get("/events/settings",requireScope("school:read"),async c=>{
  const p=c.get("principal");
  return c.json({data:await loadEventSettings(c.env.FINANCE_DB,p.organizationId)});
});

agenticEventRoutes.patch("/events/settings",requireScope("school:write"),async c=>{
  const parsed=z.object({
    enabled:z.boolean().optional(),attendanceWindowDays:z.number().int().min(1).max(90).optional(),
    attendanceAttentionCount:z.number().int().min(1).max(30).optional(),attendanceUrgentCount:z.number().int().min(1).max(30).optional(),
    booksLowStockThreshold:z.number().int().min(0).max(1000000).optional(),paymentReactionEnabled:z.boolean().optional(),
    attendanceReactionEnabled:z.boolean().optional(),hrReactionEnabled:z.boolean().optional(),booksReactionEnabled:z.boolean().optional(),
  }).safeParse(await c.req.json());
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid event reaction settings",parsed.error.flatten());
  const p=c.get("principal"),current=await loadEventSettings(c.env.FINANCE_DB,p.organizationId),next={...current,...parsed.data};
  if(next.attendanceUrgentCount<next.attendanceAttentionCount)throw new AppError(422,"VALIDATION_ERROR","Urgent absence count must be greater than or equal to attention count");
  await c.env.FINANCE_DB.prepare(`INSERT INTO ae_event_settings
    (organization_id,enabled,attendance_window_days,attendance_attention_count,attendance_urgent_count,books_low_stock_threshold,
     payment_reaction_enabled,attendance_reaction_enabled,hr_reaction_enabled,books_reaction_enabled,updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(organization_id) DO UPDATE SET enabled=excluded.enabled,attendance_window_days=excluded.attendance_window_days,
    attendance_attention_count=excluded.attendance_attention_count,attendance_urgent_count=excluded.attendance_urgent_count,
    books_low_stock_threshold=excluded.books_low_stock_threshold,payment_reaction_enabled=excluded.payment_reaction_enabled,
    attendance_reaction_enabled=excluded.attendance_reaction_enabled,hr_reaction_enabled=excluded.hr_reaction_enabled,
    books_reaction_enabled=excluded.books_reaction_enabled,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(p.organizationId,next.enabled?1:0,next.attendanceWindowDays,next.attendanceAttentionCount,next.attendanceUrgentCount,next.booksLowStockThreshold,
      next.paymentReactionEnabled?1:0,next.attendanceReactionEnabled?1:0,next.hrReactionEnabled?1:0,next.booksReactionEnabled?1:0,p.userId).run();
  return c.json({data:await loadEventSettings(c.env.FINANCE_DB,p.organizationId)});
});

agenticEventRoutes.post("/events/reactions/:id/acknowledge",requireScope("school:write"),async c=>{
  const p=c.get("principal"),id=c.req.param("id");
  const result=await c.env.FINANCE_DB.prepare(`UPDATE ae_event_reactions SET acknowledged_at=COALESCE(acknowledged_at,CURRENT_TIMESTAMP),
    acknowledged_by=COALESCE(acknowledged_by,?) WHERE id=? AND organization_id=?`).bind(p.userId,id,p.organizationId).run();
  if(!Number(result.meta.changes||0))throw new AppError(404,"NOT_FOUND","Event reaction not found");
  return c.json({data:{id,acknowledged:true}});
});

agenticEventRoutes.post("/events/process",requireScope("school:write"),async c=>{
  await processEventInbox(c.env);
  return c.json({data:{processed:true}});
});

function safeJson(value:string){try{return JSON.parse(value||"{}")}catch{return {}}}
