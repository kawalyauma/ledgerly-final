import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { AuthPrincipal, Env } from "../../../src/types";
import { dispatchCampaign, ensureBuiltinMessageTypes } from "../../communications/backend/service";
import { hasScope } from "./policy";

type ApprovalPayload = {
  audience?: {
    kind?: string;
    studentIds?: string[];
    staffIds?: string[];
    recipientMode?: "primary_guardian" | "all_guardians" | "student_direct" | "guardians_and_student";
    minimumBalanceMinor?: number;
  };
  channels?: Array<"sms" | "whatsapp">;
  subject?: string;
  message?: string;
};

function typeKeyForAudience(kind: string) {
  if (kind === "fee_balances") return "fee_balance_reminder";
  if (kind === "staff") return "staff_announcement";
  return "student_announcement";
}

export async function executeApprovedAction(env: Env, principal: AuthPrincipal, approvalId: string) {
  if (!hasScope(principal, "communications:write")) {
    throw new AppError(403, "FORBIDDEN", "Executing an AI communication requires communications:write");
  }

  const approval = await env.FINANCE_DB.prepare(`
    SELECT id, organization_id AS organizationId, action_type AS actionType,
           payload_json AS payloadJson, status, reviewed_by AS reviewedBy
    FROM ae_approvals WHERE id=? AND organization_id=?
  `).bind(approvalId, principal.organizationId).first<any>();
  if (!approval) throw new AppError(404, "NOT_FOUND", "AI approval not found");
  if (approval.status !== "approved") throw new AppError(409, "INVALID_STATE", "Only an approved action can be executed");
  if (approval.actionType !== "communication.campaign.send") {
    throw new AppError(409, "UNSUPPORTED_ACTION", "This approval action does not have an executor");
  }

  let payload: ApprovalPayload;
  try { payload = JSON.parse(approval.payloadJson || "{}"); } catch { throw new AppError(422, "INVALID_APPROVAL_PAYLOAD", "Approval payload is invalid"); }
  const audience = payload.audience || {};
  const audienceKind = String(audience.kind || "students");
  if (!["students", "staff", "fee_balances"].includes(audienceKind)) throw new AppError(422, "INVALID_AUDIENCE", "Unsupported AI communication audience");
  const channels = [...new Set((payload.channels || []).filter(channel => channel === "sms" || channel === "whatsapp"))];
  if (!channels.length) throw new AppError(422, "INVALID_CHANNELS", "No supported communication channel is present");
  const message = String(payload.message || "").trim();
  if (!message) throw new AppError(422, "INVALID_MESSAGE", "The approved communication has no message");

  await ensureBuiltinMessageTypes(env.FINANCE_DB, principal.organizationId, principal.userId);
  const typeKey = typeKeyForAudience(audienceKind);
  const type = await env.FINANCE_DB.prepare("SELECT * FROM communication_message_types WHERE organization_id=? AND type_key=? AND active=1")
    .bind(principal.organizationId, typeKey).first<any>();
  if (!type) throw new AppError(409, "MESSAGE_TYPE_NOT_FOUND", "Required communications message type is unavailable");
  const organization = await env.FINANCE_DB.prepare("SELECT name FROM organizations WHERE id=?").bind(principal.organizationId).first<{ name: string }>();
  const campaignId = createId("cmp");
  const resolvedAudience = {
    ...JSON.parse(type.audience_defaults_json || "{}"),
    kind: audienceKind,
    studentIds: Array.isArray(audience.studentIds) ? audience.studentIds.slice(0, 200) : [],
    staffIds: Array.isArray(audience.staffIds) ? audience.staffIds.slice(0, 200) : [],
    recipientMode: audience.recipientMode,
    minimumBalanceMinor: audience.minimumBalanceMinor,
  };

  await env.FINANCE_DB.prepare(`
    INSERT INTO communication_campaigns
      (id,organization_id,message_type_id,type_key,module_key,name,sender_name,subject_template,message_template,
       channels_json,audience_kind,audience_json,status,created_by,updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'draft',?,?)
  `).bind(
    campaignId,
    principal.organizationId,
    type.id,
    type.type_key,
    "agentic-employees",
    `AI ${type.name}`,
    organization?.name || "Ledgerly",
    String(payload.subject || type.subject_template || "School update").slice(0, 200),
    message.slice(0, 2000),
    JSON.stringify(channels),
    audienceKind,
    JSON.stringify(resolvedAudience),
    principal.userId,
    principal.userId,
  ).run();

  try {
    const result = await dispatchCampaign(env, campaignId);
    await env.FINANCE_DB.prepare(`
      UPDATE ae_approvals SET status='executed', executed_at=CURRENT_TIMESTAMP, execution_error=NULL
      WHERE id=? AND organization_id=? AND status='approved'
    `).bind(approvalId, principal.organizationId).run();
    return { approvalId, campaignId, ...result };
  } catch (error) {
    const messageText = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
    await env.FINANCE_DB.prepare(`
      UPDATE ae_approvals SET status='failed', executed_at=CURRENT_TIMESTAMP, execution_error=?
      WHERE id=? AND organization_id=? AND status='approved'
    `).bind(messageText, approvalId, principal.organizationId).run();
    throw error;
  }
}
