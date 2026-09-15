import { Hono } from "hono";
import type { AppVariables, AuthPrincipal, Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { requireScope } from "../../../src/lib/auth";
import { createId } from "../../../src/lib/ids";
import { executeApprovedAction } from "./executor";

export const agenticChatConfirmationRoutes =
  new Hono<{Bindings:Env;Variables:AppVariables}>();

const ACTIVE_ACTIONS = [
  "suggested",
  "prepared",
  "awaiting_approval",
  "approved",
] as const;

function parseJson(value: unknown) {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function conversationFromKey(value: unknown) {
  const match = /^conversation:([^:]+):/.exec(String(value || ""));
  return match?.[1] || null;
}

function canWrite(principal: AuthPrincipal, scope: string) {
  return (
    principal.role === "owner" ||
    principal.role === "admin" ||
    principal.scopes.includes(scope)
  );
}

async function assertConversation(
  db: D1Database,
  organizationId: string,
  id: string,
) {
  const row = await db.prepare(`
    SELECT id,agent_key AS agentKey
    FROM ae_conversations
    WHERE id=? AND organization_id=?
  `).bind(id, organizationId).first<any>();

  if (!row) {
    throw new AppError(
      404,
      "NOT_FOUND",
      "AI conversation not found",
    );
  }

  return row;
}

async function addConversationMessage(
  db: D1Database,
  organizationId: string,
  conversationId: string | null,
  userId: string,
  content: string,
) {
  if (!conversationId) return;

  const conversation = await db.prepare(`
    SELECT id
    FROM ae_conversations
    WHERE id=? AND organization_id=?
  `).bind(conversationId, organizationId).first();

  if (!conversation) return;

  await db.prepare(`
    INSERT INTO ae_messages
      (id,organization_id,conversation_id,role,content,user_id)
    VALUES (?,?,?,'assistant',?,?)
  `).bind(
    createId("aam"),
    organizationId,
    conversationId,
    content,
    userId,
  ).run();

  await db.prepare(`
    UPDATE ae_conversations
    SET last_message_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND organization_id=?
  `).bind(conversationId, organizationId).run();
}

async function getAction(
  db: D1Database,
  organizationId: string,
  id: string,
) {
  const row = await db.prepare(`
    SELECT
      id,
      event_id AS eventId,
      agent_key AS agentKey,
      action_type AS actionType,
      title,
      summary,
      required_scope AS requiredScope,
      payload_json AS payloadJson,
      idempotency_key AS idempotencyKey,
      status,
      approval_id AS approvalId,
      created_at AS createdAt
    FROM ae_actions
    WHERE id=? AND organization_id=?
  `).bind(id, organizationId).first<any>();

  if (!row) {
    throw new AppError(
      404,
      "NOT_FOUND",
      "AI action not found",
    );
  }

  return {
    ...row,
    payload: parseJson(row.payloadJson),
    conversationId: conversationFromKey(row.idempotencyKey),
  };
}

async function getApproval(
  db: D1Database,
  organizationId: string,
  id: string,
) {
  const row = await db.prepare(`
    SELECT
      id,
      conversation_id AS conversationId,
      agent_key AS agentKey,
      action_type AS actionType,
      required_scope AS requiredScope,
      payload_json AS payloadJson,
      status,
      created_at AS createdAt
    FROM ae_approvals
    WHERE id=? AND organization_id=?
  `).bind(id, organizationId).first<any>();

  if (!row) {
    throw new AppError(
      404,
      "NOT_FOUND",
      "AI approval not found",
    );
  }

  return {
    ...row,
    payload: parseJson(row.payloadJson),
  };
}

agenticChatConfirmationRoutes.get(
  "/confirmations",
  requireScope("school:read"),
  async c => {
    const principal = c.get("principal");

    const [actionsResult, approvalsResult] = await Promise.all([
      c.env.FINANCE_DB.prepare(`
        SELECT
          id,
          event_id AS eventId,
          agent_key AS agentKey,
          action_type AS actionType,
          title,
          summary,
          required_scope AS requiredScope,
          payload_json AS payloadJson,
          idempotency_key AS idempotencyKey,
          status,
          created_at AS createdAt
        FROM ae_actions
        WHERE organization_id=?
          AND status IN (
            'suggested',
            'prepared',
            'awaiting_approval',
            'approved'
          )
        ORDER BY created_at DESC
        LIMIT 100
      `).bind(principal.organizationId).all<any>(),

      c.env.FINANCE_DB.prepare(`
        SELECT
          ap.id,
          ap.conversation_id AS conversationId,
          ap.agent_key AS agentKey,
          ap.action_type AS actionType,
          ap.required_scope AS requiredScope,
          ap.payload_json AS payloadJson,
          ap.status,
          ap.created_at AS createdAt
        FROM ae_approvals ap
        WHERE ap.organization_id=?
          AND ap.status IN ('pending','approved')
          AND NOT EXISTS (
            SELECT 1
            FROM ae_actions a
            WHERE a.organization_id=ap.organization_id
              AND a.approval_id=ap.id
          )
        ORDER BY ap.created_at DESC
        LIMIT 100
      `).bind(principal.organizationId).all<any>(),
    ]);

    const actions = actionsResult.results.map(row => ({
      source: "action",
      id: row.id,
      eventId: row.eventId || null,
      conversationId: conversationFromKey(row.idempotencyKey),
      agentKey: row.agentKey,
      actionType: row.actionType,
      title: row.title,
      summary: row.summary,
      requiredScope: row.requiredScope,
      status: row.status,
      payload: parseJson(row.payloadJson),
      createdAt: row.createdAt,
    }));

    // Backward compatibility for old communications that directly
    // created ae_approvals before the inline-confirmation design.
    const approvals = approvalsResult.results.map(row => {
      const payload = parseJson(row.payloadJson);
      const subject =
        typeof payload?.subject === "string"
          ? payload.subject
          : null;

      return {
        source: "approval",
        id: row.id,
        eventId: null,
        conversationId: row.conversationId || null,
        agentKey: row.agentKey,
        actionType: row.actionType,
        title: subject
          ? `Send communication: ${subject}`
          : "Confirm AI prepared action",
        summary:
          "Review the prepared details below before Ledgerly executes this action.",
        requiredScope: row.requiredScope,
        status: row.status,
        payload,
        createdAt: row.createdAt,
      };
    });

    const data = [...actions, ...approvals].sort(
      (a, b) =>
        String(b.createdAt || "").localeCompare(
          String(a.createdAt || ""),
        ),
    );

    return c.json({ data });
  },
);


agenticChatConfirmationRoutes.post(
  "/confirmations/action/:id/confirm",
  requireScope("school:read"),
  async c => {
    const principal = c.get("principal");
    const body = await c.req.json().catch(() => ({})) as {
      conversationId?: string;
    };

    const row = await getAction(
      c.env.FINANCE_DB,
      principal.organizationId,
      c.req.param("id"),
    );

    if (!ACTIVE_ACTIONS.includes(row.status as any)) {
      throw new AppError(
        409,
        "INVALID_STATE",
        `This action is ${row.status} and cannot be confirmed`,
      );
    }

    if (!canWrite(principal, row.requiredScope)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `Confirmation requires ${row.requiredScope}`,
      );
    }

    const suppliedConversationId =
      body.conversationId
        ? String(body.conversationId)
        : null;

    if (
      row.conversationId &&
      suppliedConversationId &&
      row.conversationId !== suppliedConversationId
    ) {
      throw new AppError(
        409,
        "CONVERSATION_MISMATCH",
        "This action belongs to another AI conversation",
      );
    }

    const conversationId =
      row.conversationId || suppliedConversationId;

    if (conversationId) {
      const conversation = await assertConversation(
        c.env.FINANCE_DB,
        principal.organizationId,
        conversationId,
      );

      if (
        row.eventId &&
        conversation.agentKey !== row.agentKey
      ) {
        throw new AppError(
          409,
          "AGENT_MISMATCH",
          "Open this action in the employee conversation that prepared it",
        );
      }
    }

    let approvalId = row.approvalId
      ? String(row.approvalId)
      : "";

    if (approvalId) {
      const approval = await getApproval(
        c.env.FINANCE_DB,
        principal.organizationId,
        approvalId,
      );

      if (approval.status === "pending") {
        await c.env.FINANCE_DB.prepare(`
          UPDATE ae_approvals
          SET status='approved',
              reviewed_by=?,
              reviewed_at=CURRENT_TIMESTAMP
          WHERE id=? AND organization_id=? AND status='pending'
        `).bind(
          principal.userId,
          approvalId,
          principal.organizationId,
        ).run();
      } else if (approval.status !== "approved") {
        throw new AppError(
          409,
          "INVALID_STATE",
          `The linked approval is ${approval.status}`,
        );
      }
    } else {
      approvalId = createId("aaa");

      await c.env.FINANCE_DB.prepare(`
        INSERT INTO ae_approvals
          (
            id,
            organization_id,
            conversation_id,
            agent_key,
            requested_by,
            action_type,
            required_scope,
            payload_json,
            status,
            reviewed_by,
            reviewed_at
          )
        VALUES (?,?,?,?,?,?,?,?,'approved',?,CURRENT_TIMESTAMP)
      `).bind(
        approvalId,
        principal.organizationId,
        conversationId,
        row.agentKey,
        principal.userId,
        row.actionType,
        row.requiredScope,
        JSON.stringify(row.payload),
        principal.userId,
      ).run();
    }

    await c.env.FINANCE_DB.prepare(`
      UPDATE ae_actions
      SET status='approved',
          approval_id=?,
          prepared_by=COALESCE(prepared_by,?),
          prepared_at=COALESCE(prepared_at,CURRENT_TIMESTAMP),
          approved_by=?,
          approved_at=COALESCE(approved_at,CURRENT_TIMESTAMP),
          failure_text=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND organization_id=?
    `).bind(
      approvalId,
      principal.userId,
      principal.userId,
      row.id,
      principal.organizationId,
    ).run();

    try {
      const result = await executeApprovedAction(
        c.env,
        principal,
        approvalId,
      );

      await c.env.FINANCE_DB.prepare(`
        UPDATE ae_actions
        SET status='executed',
            result_entity_type=?,
            result_entity_id=?,
            executed_by=?,
            executed_at=COALESCE(
              executed_at,
              CURRENT_TIMESTAMP
            ),
            failure_text=NULL,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND organization_id=?
      `).bind(
        (result as any)?.entityType || null,
        (result as any)?.entityId || null,
        principal.userId,
        row.id,
        principal.organizationId,
      ).run();

      await addConversationMessage(
        c.env.FINANCE_DB,
        principal.organizationId,
        conversationId,
        principal.userId,
        `✅ **Completed:** ${row.title}`,
      );

      return c.json({
        data: {
          confirmed: true,
          executed: true,
          actionId: row.id,
          approvalId,
          result,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : String(error).slice(0, 1000);

      await c.env.FINANCE_DB.prepare(`
        UPDATE ae_actions
        SET status='failed',
            failure_text=?,
            updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND organization_id=?
          AND status<>'executed'
      `).bind(
        message,
        row.id,
        principal.organizationId,
      ).run();

      await addConversationMessage(
        c.env.FINANCE_DB,
        principal.organizationId,
        conversationId,
        principal.userId,
        `⚠️ **Action failed:** ${row.title}\n\n${message}`,
      );

      throw error;
    }
  },
);


agenticChatConfirmationRoutes.post(
  "/confirmations/approval/:id/confirm",
  requireScope("school:read"),
  async c => {
    const principal = c.get("principal");
    const body = await c.req.json().catch(() => ({})) as {
      conversationId?: string;
    };

    const row = await getApproval(
      c.env.FINANCE_DB,
      principal.organizationId,
      c.req.param("id"),
    );

    if (!["pending", "approved"].includes(row.status)) {
      throw new AppError(
        409,
        "INVALID_STATE",
        `This approval is ${row.status}`,
      );
    }

    if (!canWrite(principal, row.requiredScope)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `Confirmation requires ${row.requiredScope}`,
      );
    }

    const conversationId =
      row.conversationId ||
      (body.conversationId
        ? String(body.conversationId)
        : null);

    if (conversationId) {
      await assertConversation(
        c.env.FINANCE_DB,
        principal.organizationId,
        conversationId,
      );
    }

    if (row.status === "pending") {
      await c.env.FINANCE_DB.prepare(`
        UPDATE ae_approvals
        SET status='approved',
            reviewed_by=?,
            reviewed_at=CURRENT_TIMESTAMP
        WHERE id=? AND organization_id=? AND status='pending'
      `).bind(
        principal.userId,
        row.id,
        principal.organizationId,
      ).run();
    }

    try {
      const result = await executeApprovedAction(
        c.env,
        principal,
        row.id,
      );

      await addConversationMessage(
        c.env.FINANCE_DB,
        principal.organizationId,
        conversationId,
        principal.userId,
        "✅ **Completed:** The confirmed action was executed successfully.",
      );

      return c.json({
        data: {
          confirmed: true,
          executed: true,
          approvalId: row.id,
          result,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : String(error).slice(0, 1000);

      await addConversationMessage(
        c.env.FINANCE_DB,
        principal.organizationId,
        conversationId,
        principal.userId,
        `⚠️ **Action failed:** ${message}`,
      );

      throw error;
    }
  },
);


agenticChatConfirmationRoutes.post(
  "/confirmations/action/:id/cancel",
  requireScope("school:read"),
  async c => {
    const principal = c.get("principal");
    const body = await c.req.json().catch(() => ({})) as {
      conversationId?: string;
    };

    const row = await getAction(
      c.env.FINANCE_DB,
      principal.organizationId,
      c.req.param("id"),
    );

    if (
      ["executing", "executed", "failed", "dismissed"]
        .includes(row.status)
    ) {
      throw new AppError(
        409,
        "INVALID_STATE",
        `This action is already ${row.status}`,
      );
    }

    if (!canWrite(principal, row.requiredScope)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `Cancellation requires ${row.requiredScope}`,
      );
    }

    const conversationId =
      row.conversationId ||
      (body.conversationId
        ? String(body.conversationId)
        : null);

    await c.env.FINANCE_DB.prepare(`
      UPDATE ae_actions
      SET status='dismissed',
          dismissed_by=?,
          dismissed_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND organization_id=?
    `).bind(
      principal.userId,
      row.id,
      principal.organizationId,
    ).run();

    if (row.approvalId) {
      await c.env.FINANCE_DB.prepare(`
        UPDATE ae_approvals
        SET status='cancelled',
            reviewed_by=?,
            reviewed_at=CURRENT_TIMESTAMP
        WHERE id=? AND organization_id=?
          AND status IN ('pending','approved')
      `).bind(
        principal.userId,
        row.approvalId,
        principal.organizationId,
      ).run();
    }

    await addConversationMessage(
      c.env.FINANCE_DB,
      principal.organizationId,
      conversationId,
      principal.userId,
      `❌ **Cancelled:** ${row.title}`,
    );

    return c.json({
      data: {
        cancelled: true,
        actionId: row.id,
      },
    });
  },
);


agenticChatConfirmationRoutes.post(
  "/confirmations/approval/:id/cancel",
  requireScope("school:read"),
  async c => {
    const principal = c.get("principal");
    const row = await getApproval(
      c.env.FINANCE_DB,
      principal.organizationId,
      c.req.param("id"),
    );

    if (!["pending", "approved"].includes(row.status)) {
      throw new AppError(
        409,
        "INVALID_STATE",
        `This approval is already ${row.status}`,
      );
    }

    if (!canWrite(principal, row.requiredScope)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `Cancellation requires ${row.requiredScope}`,
      );
    }

    await c.env.FINANCE_DB.prepare(`
      UPDATE ae_approvals
      SET status='rejected',
          reviewed_by=?,
          reviewed_at=CURRENT_TIMESTAMP
      WHERE id=? AND organization_id=?
    `).bind(
      principal.userId,
      row.id,
      principal.organizationId,
    ).run();

    await addConversationMessage(
      c.env.FINANCE_DB,
      principal.organizationId,
      row.conversationId || null,
      principal.userId,
      "❌ **Cancelled:** The prepared action was not executed.",
    );

    return c.json({
      data: {
        cancelled: true,
        approvalId: row.id,
      },
    });
  },
);
