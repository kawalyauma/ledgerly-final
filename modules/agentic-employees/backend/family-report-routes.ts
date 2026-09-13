import { Hono } from "hono";
import { AppError } from "../../../src/lib/errors";
import { requireScope } from "../../../src/lib/auth";
import type { AppVariables, Env } from "../../../src/types";

export const agenticFamilyReportRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

agenticFamilyReportRoutes.get("/family-reports", requireScope("school:read"), async c => {
  const p = c.get("principal");
  const limit = Math.max(1, Math.min(100, Number(c.req.query("limit") || 30)));
  const rows = await c.env.FINANCE_DB.prepare(`
    SELECT r.id,r.requested_agent_key AS requestedAgentKey,r.guardian_id AS guardianId,
           r.guardian_query AS guardianQuery,r.student_filter_json AS studentFilterJson,r.created_at AS createdAt,
           g.first_name AS guardianFirstName,g.middle_name AS guardianMiddleName,g.last_name AS guardianLastName
    FROM ae_family_reports r
    LEFT JOIN school_guardians g ON g.id=r.guardian_id AND g.organization_id=r.organization_id
    WHERE r.organization_id=? ORDER BY r.created_at DESC LIMIT ?
  `).bind(p.organizationId, limit).all<Record<string, unknown>>();
  return c.json({ data: rows.results.map(row => ({
    ...row,
    studentFilter: typeof row.studentFilterJson === "string" ? safeJson(row.studentFilterJson) : {},
    studentFilterJson: undefined,
  })) });
});

agenticFamilyReportRoutes.get("/family-reports/:id", requireScope("school:read"), async c => {
  const p = c.get("principal");
  const row = await c.env.FINANCE_DB.prepare(`
    SELECT id,requested_agent_key AS requestedAgentKey,guardian_id AS guardianId,guardian_query AS guardianQuery,
           student_filter_json AS studentFilterJson,snapshot_json AS snapshotJson,created_at AS createdAt
    FROM ae_family_reports WHERE id=? AND organization_id=?
  `).bind(c.req.param("id"), p.organizationId).first<Record<string, unknown>>();
  if (!row) throw new AppError(404, "NOT_FOUND", "AI family report not found");
  return c.json({ data: {
    id: row.id,
    requestedAgentKey: row.requestedAgentKey,
    guardianId: row.guardianId,
    guardianQuery: row.guardianQuery,
    studentFilter: safeJson(String(row.studentFilterJson || "{}")),
    report: safeJson(String(row.snapshotJson || "{}")),
    createdAt: row.createdAt,
  } });
});

agenticFamilyReportRoutes.get("/delegations", requireScope("school:read"), async c => {
  const p = c.get("principal");
  const limit = Math.max(1, Math.min(100, Number(c.req.query("limit") || 50)));
  const rows = await c.env.FINANCE_DB.prepare(`
    SELECT id,parent_conversation_id AS parentConversationId,child_conversation_id AS childConversationId,
           from_agent_key AS fromAgentKey,to_agent_key AS toAgentKey,request_text AS requestText,status,
           response_text AS responseText,model,error_text AS errorText,created_at AS createdAt,completed_at AS completedAt
    FROM ae_delegations WHERE organization_id=? ORDER BY created_at DESC LIMIT ?
  `).bind(p.organizationId, limit).all();
  return c.json({ data: rows.results });
});

function safeJson(value: string) {
  try { return JSON.parse(value); } catch { return {}; }
}
