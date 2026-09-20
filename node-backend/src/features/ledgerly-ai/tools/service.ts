import type { AuthPrincipal, AuthRole } from "../../../http/types.js";
import type { Runtime } from "../../../runtime.js";
import { AppError } from "../../../http/errors.js";
import { createId } from "../../core-identity/security.js";
import type { LedgerlyAiConfig } from "../config.js";
import type { LedgerlyAiEmployeeRegistry } from "../employees/registry.js";
import type { LedgerlyAiEmployee } from "../employees/types.js";
import { redactLedgerlyAiValue } from "../gateway/redaction.js";
import type { LedgerlyAiPolicyService } from "../policy/service.js";
import type { LedgerlyAiSecurityService } from "../security/service.js";
import { actionTools } from "./action-tools.js";
import { academicsTools } from "./academics-tools.js";
import { databaseTools } from "./database-tools.js";
import { engineeringTools } from "./engineering-tools.js";
import { financeTools } from "./finance-tools.js";
import { LedgerlyAiToolRegistry } from "./registry.js";
import { schoolTools } from "./school-tools.js";
import type {
  LedgerlyAiToolDefinition,
  LedgerlyAiToolInvocationResult,
} from "./types.js";

type ToolCallRow = {
  id: string;
  organizationId: string;
  jobId: string | null;
  chatId: string | null;
  agentId: string | null;
  requestedBy: string;
  toolName: string;
  arguments: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high" | "critical";
  status: string;
  correlationId: string;
  approvalId: string | null;
};

type ApprovalRow = {
  id: string;
  organizationId: string;
  requestedBy: string;
  agentId: string | null;
  jobId: string | null;
  actionType: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  status: string;
  toolCallId: string | null;
  toolName: string | null;
  requiredScopes: unknown;
  payload: Record<string, unknown>;
  expiresAt: string | null;
  approvalMode: "single" | "two_step";
  requiredApprovals: number;
  approvalPolicy: Record<string, unknown>;
};

function isAdmin(principal: AuthPrincipal) {
  return principal.role === "owner" || principal.role === "admin";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function scopeSatisfied(
  principal: AuthPrincipal,
  required: string[],
  mode: "all" | "any",
) {
  if (isAdmin(principal)) return true;
  if (!required.length) return true;
  return mode === "all"
    ? required.every((scope) => principal.scopes.includes(scope))
    : required.some((scope) => principal.scopes.includes(scope));
}

function boundedJson(value: unknown, maxBytes: number) {
  const redacted = redactLedgerlyAiValue(value);
  const json = JSON.stringify(redacted ?? null);
  if (Buffer.byteLength(json) <= maxBytes) return redacted;
  return {
    truncated: true,
    preview: json.slice(0, Math.max(0, maxBytes - 2000)),
    originalBytes: Buffer.byteLength(json),
  };
}

export class LedgerlyAiToolService {
  readonly registry = new LedgerlyAiToolRegistry();

  constructor(
    private readonly runtime: Runtime,
    private readonly config: LedgerlyAiConfig,
    private readonly employees: LedgerlyAiEmployeeRegistry,
    private readonly policy: LedgerlyAiPolicyService,
    private readonly security: LedgerlyAiSecurityService,
  ) {
    this.registry.registerMany([
      ...schoolTools,
      ...financeTools,
      ...databaseTools,
      ...actionTools,
      ...academicsTools,
      ...engineeringTools,
    ]);
  }

  catalog(principal: AuthPrincipal, employee: LedgerlyAiEmployee | null) {
    return this.registry.catalog(principal, employee);
  }

  private async audit(input: {
    principal: AuthPrincipal;
    action: string;
    entityType: string;
    entityId: string;
    correlationId: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.runtime.db.query(
      `INSERT INTO lai_audit_events(
        id,organization_id,actor_type,actor_id,action,entity_type,entity_id,correlation_id,metadata_json
      ) VALUES($1,$2,'user',$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        createId("laia"),
        input.principal.organizationId,
        input.principal.userId,
        input.action,
        input.entityType,
        input.entityId,
        input.correlationId,
        JSON.stringify(boundedJson(input.metadata ?? {}, this.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES)),
      ],
    );
  }

  private async executeDefinition(
    toolCallId: string,
    tool: LedgerlyAiToolDefinition,
    input: Record<string, unknown>,
    context: {
      principal: AuthPrincipal;
      employee: LedgerlyAiEmployee | null;
      correlationId: string;
      chatId?: string | null;
      jobId?: string | null;
      approvalId?: string | null;
      approvedBy?: string | null;
    },
  ) {
    const started = Date.now();
    try {
      const result = await tool.execute(
        {
          runtime: this.runtime,
          config: this.config,
          principal: context.principal,
          employee: context.employee,
          correlationId: context.correlationId,
          chatId: context.chatId,
          jobId: context.jobId,
          approvalId: context.approvalId,
          approvedBy: context.approvedBy,
        },
        input,
      );
      const durationMs = Date.now() - started;
      const stored = boundedJson(result, this.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES);
      await this.runtime.db.query(
        `UPDATE lai_tool_calls
            SET status='succeeded',result_json=$1::jsonb,duration_ms=$2,
                completed_at=CURRENT_TIMESTAMP,error_text=NULL
          WHERE id=$3 AND organization_id=$4`,
        [JSON.stringify(stored), durationMs, toolCallId, context.principal.organizationId],
      );
      await this.audit({
        principal: context.principal,
        action: "ledgerly_ai.tool.succeeded",
        entityType: "tool_call",
        entityId: toolCallId,
        correlationId: context.correlationId,
        metadata: { toolName: tool.name, riskLevel: tool.riskLevel, durationMs, approvalId: context.approvalId ?? null },
      });
      return { result: stored, durationMs };
    } catch (error) {
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      await this.runtime.db.query(
        `UPDATE lai_tool_calls
            SET status='failed',error_text=$1,duration_ms=$2,completed_at=CURRENT_TIMESTAMP
          WHERE id=$3 AND organization_id=$4`,
        [message.slice(0, 4000), durationMs, toolCallId, context.principal.organizationId],
      );
      await this.audit({
        principal: context.principal,
        action: "ledgerly_ai.tool.failed",
        entityType: "tool_call",
        entityId: toolCallId,
        correlationId: context.correlationId,
        metadata: { toolName: tool.name, riskLevel: tool.riskLevel, durationMs },
      });
      throw error;
    }
  }

  async invoke(input: {
    principal: AuthPrincipal;
    employee: LedgerlyAiEmployee | null;
    toolName: string;
    arguments: unknown;
    correlationId: string;
    chatId?: string | null;
    jobId?: string | null;
  }): Promise<LedgerlyAiToolInvocationResult> {
    const tool = this.registry.get(input.toolName);
    await this.security.assertToolBoundary({
      principal:input.principal,employee:input.employee,toolName:tool.name,
      arguments:input.arguments,correlationId:input.correlationId,
    });
    this.registry.assertAllowed(input.principal, input.employee, tool);
    const parsed = tool.inputSchema.safeParse(input.arguments);
    if (!parsed.success) {
      throw new AppError(
        422,
        "LEDGERLY_AI_TOOL_VALIDATION_ERROR",
        "Ledgerly AI tool arguments are invalid.",
        parsed.error.flatten(),
      );
    }

    const decision = await this.policy.evaluateTool({
      principal: input.principal,
      employee: input.employee,
      tool,
    });
    if (decision.effect === "deny") {
      await this.policy.privilegedAudit({
        organizationId: input.principal.organizationId,
        actorType: "user",
        actorId: input.principal.userId,
        action: "ledgerly_ai.tool.denied_by_policy",
        entityType: "tool",
        entityId: tool.name,
        correlationId: input.correlationId,
        riskLevel: tool.riskLevel,
        metadata: {
          agentId: input.employee?.id ?? null,
          agentKey: input.employee?.key ?? null,
          reason: decision.reason,
          ruleId: decision.ruleId,
        },
      });
      throw new AppError(403, "LEDGERLY_AI_POLICY_DENIED", decision.reason, {
        toolName: tool.name,
        riskLevel: tool.riskLevel,
        ruleId: decision.ruleId,
      });
    }

    const requiresApproval = decision.effect === "single" || decision.effect === "two_step";
    if (requiresApproval && input.principal.role === "integration") {
      throw new AppError(403, "FORBIDDEN", "Integration identities cannot request approval-gated Ledgerly AI actions.");
    }

    const toolCallId = createId("laitc");
    const argumentsJson = boundedJson(parsed.data, this.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES);
    if (requiresApproval) {
      const approvalId = createId("laiap");
      const client = await this.runtime.db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO lai_tool_calls(
            id,organization_id,job_id,chat_id,agent_id,requested_by,tool_name,
            arguments_json,risk_level,status,correlation_id,approval_id
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'waiting_approval',$10,$11)`,
          [
            toolCallId,input.principal.organizationId,input.jobId ?? null,input.chatId ?? null,
            input.employee?.id ?? null,input.principal.userId,tool.name,JSON.stringify(argumentsJson),
            tool.riskLevel,input.correlationId,approvalId,
          ],
        );
        await client.query(
          `INSERT INTO lai_approvals(
            id,organization_id,requested_by,agent_id,job_id,action_type,risk_level,status,
            payload_json,tool_call_id,tool_name,required_scopes_json,expires_at,
            approval_mode,required_approvals,approval_policy_json
          ) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8::jsonb,$9,$10,$11::jsonb,
                   CURRENT_TIMESTAMP + INTERVAL '24 hours',$12,$13,$14::jsonb)`,
          [
            approvalId,input.principal.organizationId,input.principal.userId,input.employee?.id ?? null,
            input.jobId ?? null,"tool." + tool.name,tool.riskLevel,JSON.stringify(argumentsJson),
            toolCallId,tool.name,JSON.stringify(tool.requiredScopes),
            decision.approvalMode,decision.requiredApprovals,
            JSON.stringify({
              reviewerRole:decision.reviewerRole,
              reason:decision.reason,
              ruleId:decision.ruleId,
              productionAction:Boolean(tool.productionAction),
              destructive:Boolean(tool.destructive),
            }),
          ],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await this.audit({
        principal: input.principal,
        action: "ledgerly_ai.tool.approval_requested",
        entityType: "approval",
        entityId: approvalId,
        correlationId: input.correlationId,
        metadata: {
          toolCallId, toolName: tool.name, riskLevel: tool.riskLevel,
          requiredScopes: tool.requiredScopes, approvalMode: decision.approvalMode,
          requiredApprovals: decision.requiredApprovals, ruleId: decision.ruleId,
        },
      });
      await this.policy.privilegedAudit({
        organizationId: input.principal.organizationId,
        actorType: "user",
        actorId: input.principal.userId,
        action: "ledgerly_ai.approval.requested",
        entityType: "approval",
        entityId: approvalId,
        correlationId: input.correlationId,
        riskLevel: tool.riskLevel,
        metadata: {
          toolCallId,toolName:tool.name,agentId:input.employee?.id??null,
          approvalMode:decision.approvalMode,requiredApprovals:decision.requiredApprovals,
          reviewerRole:decision.reviewerRole,ruleId:decision.ruleId,
        },
      });
      return {
        status: "waiting_approval",
        toolCallId,
        toolName: tool.name,
        approvalId,
        riskLevel: tool.riskLevel,
        requiredScopes: tool.requiredScopes,
        approvalMode: decision.approvalMode!,
        requiredApprovals: decision.requiredApprovals,
      };
    }

    await this.runtime.db.query(
      `INSERT INTO lai_tool_calls(
        id,organization_id,job_id,chat_id,agent_id,requested_by,tool_name,
        arguments_json,risk_level,status,correlation_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'running',$10)`,
      [
        toolCallId,input.principal.organizationId,input.jobId ?? null,input.chatId ?? null,
        input.employee?.id ?? null,input.principal.userId,tool.name,JSON.stringify(argumentsJson),
        tool.riskLevel,input.correlationId,
      ],
    );

    const executed = await this.executeDefinition(
      toolCallId,
      tool,
      parsed.data as Record<string, unknown>,
      {
        principal: input.principal,
        employee: input.employee,
        correlationId: input.correlationId,
        chatId: input.chatId,
        jobId: input.jobId,
      },
    );
    if (tool.mutating || tool.riskLevel === "high" || tool.riskLevel === "critical") {
      await this.policy.privilegedAudit({
        organizationId: input.principal.organizationId,
        actorType: "user",
        actorId: input.principal.userId,
        action: "ledgerly_ai.tool.auto_executed",
        entityType: "tool_call",
        entityId: toolCallId,
        correlationId: input.correlationId,
        riskLevel: tool.riskLevel,
        metadata: {
          toolName: tool.name,agentId:input.employee?.id??null,ruleId:decision.ruleId,
          policyReason:decision.reason,
        },
      });
    }
    return {
      status: "succeeded",
      toolCallId,
      toolName: tool.name,
      result: executed.result,
      durationMs: executed.durationMs,
    };
  }

  private async requesterPrincipal(organizationId: string, userId: string): Promise<AuthPrincipal> {
    const result = await this.runtime.db.query<{ role: AuthRole; scopes: unknown }>(
      `SELECT m.role,m.scopes
         FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.organization_id=$1 AND m.user_id=$2 AND u.status='active'`,
      [organizationId,userId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(409, "TOOL_REQUESTER_INACTIVE", "The original requester is no longer an active organization member.");
    return {
      userId,
      organizationId,
      role: row.role,
      scopes: stringArray(row.scopes),
    };
  }

  private async approvalRow(principal: AuthPrincipal, approvalId: string) {
    const result = await this.runtime.db.query<ApprovalRow>(
      `SELECT id,organization_id AS "organizationId",requested_by AS "requestedBy",
              agent_id AS "agentId",job_id AS "jobId",action_type AS "actionType",
              risk_level AS "riskLevel",status,tool_call_id AS "toolCallId",tool_name AS "toolName",
              required_scopes_json AS "requiredScopes",payload_json AS payload,expires_at AS "expiresAt",
              approval_mode AS "approvalMode",required_approvals AS "requiredApprovals",
              approval_policy_json AS "approvalPolicy"
         FROM lai_approvals WHERE id=$1 AND organization_id=$2`,
      [approvalId,principal.organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "LEDGERLY_AI_APPROVAL_NOT_FOUND", "Ledgerly AI approval not found.");
    return row;
  }

  async listApprovals(principal: AuthPrincipal, status = "pending") {
    const result = await this.runtime.db.query<{
      id: string;
      requestedBy: string;
      agentId: string | null;
      jobId: string | null;
      actionType: string;
      riskLevel: string;
      status: string;
      toolCallId: string;
      toolName: string;
      requiredScopes: unknown;
      payload: Record<string, unknown>;
      expiresAt: string | null;
      approvalMode: "single" | "two_step";
      requiredApprovals: number;
      approvalCount: number;
      reviewerRole: string | null;
      createdAt: string;
    }>(
      `SELECT id,requested_by AS "requestedBy",agent_id AS "agentId",job_id AS "jobId",
              action_type AS "actionType",risk_level AS "riskLevel",status,tool_call_id AS "toolCallId",
              tool_name AS "toolName",required_scopes_json AS "requiredScopes",
              payload_json AS payload,expires_at AS "expiresAt",
              approval_mode AS "approvalMode",required_approvals AS "requiredApprovals",
              COALESCE((SELECT COUNT(*) FROM lai_approval_reviews r
                WHERE r.approval_id=lai_approvals.id AND r.decision='approved'),0)::int AS "approvalCount",
              approval_policy_json->>'reviewerRole' AS "reviewerRole",
              created_at AS "createdAt"
         FROM lai_approvals
        WHERE organization_id=$1 AND status=$2 AND tool_call_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 200`,
      [principal.organizationId,status],
    );
    return result.rows.filter((row) => {
      try {
        const tool = this.registry.get(row.toolName);
        return scopeSatisfied(principal, stringArray(row.requiredScopes), tool.scopeMode ?? "all");
      } catch {
        return false;
      }
    });
  }

  async approve(principal: AuthPrincipal, approvalId: string, note?: string) {
    let approval = await this.approvalRow(principal, approvalId);
    if (approval.status !== "pending") {
      throw new AppError(409, "LEDGERLY_AI_APPROVAL_REVIEWED", "This approval has already been reviewed.");
    }
    if (approval.expiresAt && new Date(approval.expiresAt).getTime() <= Date.now()) {
      const client = await this.runtime.db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE lai_approvals SET status='cancelled',reviewed_by=$1,review_note='Expired',reviewed_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3 AND status='pending'",
          [principal.userId,approvalId,principal.organizationId],
        );
        if (approval.toolCallId) {
          await client.query(
            "UPDATE lai_tool_calls SET status='denied',error_text='Approval expired',completed_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status='waiting_approval'",
            [approval.toolCallId,principal.organizationId],
          );
        }
        if (approval.jobId) {
          await client.query(
            "UPDATE lai_jobs SET status='cancelled',error_text='Approval expired',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status='waiting_approval'",
            [approval.jobId,principal.organizationId],
          );
          await client.query(
            "UPDATE lai_custom_agent_runs SET status='cancelled',error_text='Approval expired',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND job_id=$2 AND status='waiting_approval'",
            [principal.organizationId,approval.jobId],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await this.policy.privilegedAudit({
        organizationId:principal.organizationId,actorType:"user",actorId:principal.userId,
        action:"ledgerly_ai.approval.expired",entityType:"approval",entityId:approvalId,
        correlationId:"approval:"+approvalId,riskLevel:approval.riskLevel,
      });
      throw new AppError(409, "LEDGERLY_AI_APPROVAL_EXPIRED", "This approval request has expired.");
    }
    if (!approval.toolName || !approval.toolCallId) {
      throw new AppError(409, "LEDGERLY_AI_APPROVAL_INVALID", "Approval is not linked to an executable tool call.");
    }

    const tool = this.registry.get(approval.toolName);
    const required = stringArray(approval.requiredScopes);
    if (!scopeSatisfied(principal, required, tool.scopeMode ?? "all")) {
      throw new AppError(403, "FORBIDDEN", "You do not hold the Ledgerly permissions required to approve this action.", {
        requiredScopes: required,
      });
    }

    const storedReviewerRole = approval.approvalPolicy?.reviewerRole;
    const reviewerRole = storedReviewerRole === "owner" ? "owner" : "admin";
    this.policy.assertReviewer(principal, reviewerRole);
    if (approval.approvalMode === "two_step" && approval.requestedBy === principal.userId) {
      throw new AppError(403, "LEDGERLY_AI_TWO_STEP_SELF_APPROVAL",
        "The requester cannot serve as one of the two reviewers for this sensitive action.");
    }
    const priorReview = await this.runtime.db.query(
      "SELECT decision FROM lai_approval_reviews WHERE approval_id=$1 AND organization_id=$2 AND reviewer_id=$3 LIMIT 1",
      [approvalId,principal.organizationId,principal.userId],
    );
    if (priorReview.rowCount) {
      throw new AppError(409, "LEDGERLY_AI_APPROVAL_ALREADY_REVIEWED_BY_USER",
        "You have already reviewed this approval request.");
    }

    const requester = await this.requesterPrincipal(approval.organizationId, approval.requestedBy);
    const employee = approval.agentId
      ? await this.employees.resolveSelectable(requester, approval.agentId)
      : null;
    this.registry.assertAllowed(requester, employee, tool);
    const parsed = tool.inputSchema.safeParse(approval.payload);
    if (!parsed.success) {
      throw new AppError(409, "LEDGERLY_AI_APPROVAL_PAYLOAD_INVALID", "Stored approval arguments no longer validate.");
    }

    const currentDecision = await this.policy.evaluateTool({principal:requester,employee,tool});
    if (currentDecision.effect === "deny") {
      throw new AppError(409, "LEDGERLY_AI_POLICY_CHANGED",
        "Current Ledgerly AI policy now denies this action.",{
          reason:currentDecision.reason,ruleId:currentDecision.ruleId,
        });
    }
    const currentRequired = currentDecision.effect === "two_step" ? 2 :
      currentDecision.effect === "single" ? 1 : 0;
    if (currentRequired > approval.requiredApprovals) {
      await this.runtime.db.query(
        `UPDATE lai_approvals SET approval_mode=$1,required_approvals=$2,
            approval_policy_json=approval_policy_json||$3::jsonb
          WHERE id=$4 AND organization_id=$5 AND status='pending'`,
        [
          currentRequired >= 2 ? "two_step" : "single",currentRequired,
          JSON.stringify({
            reviewerRole:currentDecision.reviewerRole,
            reason:currentDecision.reason,
            ruleId:currentDecision.ruleId,
            upgradedAt:new Date().toISOString(),
          }),
          approvalId,principal.organizationId,
        ],
      );
      approval=await this.approvalRow(principal,approvalId);
      const upgradedRole=approval.approvalPolicy?.reviewerRole==="owner"?"owner":"admin";
      this.policy.assertReviewer(principal,upgradedRole);
      if(approval.approvalMode==="two_step"&&approval.requestedBy===principal.userId){
        throw new AppError(403,"LEDGERLY_AI_TWO_STEP_SELF_APPROVAL",
          "The requester cannot serve as one of the two reviewers for this sensitive action.");
      }
    }

    const reviewId=createId("laiar");
    const client=await this.runtime.db.connect();
    let approvalCount=0;
    let executionClaimed=false;
    try{
      await client.query("BEGIN");
      const locked=await client.query<{status:string}>(
        "SELECT status FROM lai_approvals WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [approvalId,principal.organizationId],
      );
      if(locked.rows[0]?.status!=="pending"){
        throw new AppError(409,"LEDGERLY_AI_APPROVAL_REVIEWED","Approval was reviewed by another request.");
      }
      await client.query(
        `INSERT INTO lai_approval_reviews(
          id,approval_id,organization_id,reviewer_id,decision,note,metadata_json
        ) VALUES($1,$2,$3,$4,'approved',$5,$6::jsonb)`,
        [
          reviewId,approvalId,principal.organizationId,principal.userId,note?.slice(0,2000)??null,
          JSON.stringify({role:principal.role,approvalMode:approval.approvalMode}),
        ],
      );
      const count=await client.query<{count:number}>(
        `SELECT COUNT(*)::int AS count FROM lai_approval_reviews
          WHERE approval_id=$1 AND organization_id=$2 AND decision='approved'`,
        [approvalId,principal.organizationId],
      );
      approvalCount=Number(count.rows[0]?.count??0);
      if(approvalCount>=approval.requiredApprovals){
        const promoted=await client.query(
          `UPDATE lai_approvals
              SET status='approved',reviewed_by=$1,review_note=$2,reviewed_at=CURRENT_TIMESTAMP
            WHERE id=$3 AND organization_id=$4 AND status='pending'
            RETURNING id`,
          [principal.userId,note??null,approvalId,principal.organizationId],
        );
        executionClaimed=Boolean(promoted.rowCount);
      }
      await client.query("COMMIT");
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }finally{client.release();}

    await this.policy.privilegedAudit({
      organizationId:principal.organizationId,actorType:"user",actorId:principal.userId,
      action:"ledgerly_ai.approval.reviewed",entityType:"approval",entityId:approvalId,
      correlationId:"approval:"+approvalId,riskLevel:approval.riskLevel,
      metadata:{
        decision:"approved",reviewId,approvalMode:approval.approvalMode,
        approvalCount,requiredApprovals:approval.requiredApprovals,toolName:tool.name,
      },
    });

    if(approvalCount<approval.requiredApprovals){
      return{
        id:approvalId,status:"pending",toolCallId:approval.toolCallId,
        approvalCount,requiredApprovals:approval.requiredApprovals,
      };
    }

    if(!executionClaimed){
      const final=await this.approvalRow(principal,approvalId);
      return{
        id:approvalId,status:final.status,toolCallId:approval.toolCallId,
        approvalCount,requiredApprovals:approval.requiredApprovals,
      };
    }

    try {
      await this.runtime.db.query(
        "UPDATE lai_tool_calls SET status='running' WHERE id=$1 AND organization_id=$2 AND status='waiting_approval'",
        [approval.toolCallId,principal.organizationId],
      );
      const executed = await this.executeDefinition(
        approval.toolCallId,
        tool,
        parsed.data as Record<string, unknown>,
        {
          principal: requester,
          employee,
          correlationId: "approval:" + approvalId,
          jobId: approval.jobId,
          approvalId,
          approvedBy: principal.userId,
        },
      );
      await this.runtime.db.query(
        `UPDATE lai_approvals
            SET status='executed',executed_at=CURRENT_TIMESTAMP,execution_result_json=$1::jsonb
          WHERE id=$2 AND organization_id=$3 AND status='approved'`,
        [JSON.stringify(executed.result),approvalId,principal.organizationId],
      );
      if (approval.jobId) {
        const completion = {
          approvalId,
          toolCallId: approval.toolCallId,
          toolName: tool.name,
          approvalStatus: "executed",
        };
        await this.runtime.db.query(
          `UPDATE lai_jobs
              SET status='completed',
                  result_json=COALESCE(result_json,'{}'::jsonb) || $1::jsonb,
                  completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,error_text=NULL
            WHERE id=$2 AND organization_id=$3 AND status='waiting_approval'`,
          [JSON.stringify(completion),approval.jobId,principal.organizationId],
        );
        await this.runtime.db.query(
          `UPDATE lai_custom_agent_runs
              SET status='completed',
                  result_json=COALESCE(result_json,'{}'::jsonb) || $1::jsonb,
                  completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,error_text=NULL
            WHERE organization_id=$2 AND job_id=$3 AND status='waiting_approval'`,
          [JSON.stringify(completion),principal.organizationId,approval.jobId],
        );
      }
      await this.audit({
        principal,
        action: "ledgerly_ai.tool.approval_executed",
        entityType: "approval",
        entityId: approvalId,
        correlationId: "approval:" + approvalId,
        metadata: { toolName: tool.name, toolCallId: approval.toolCallId, requestedBy: requester.userId },
      });
      await this.policy.privilegedAudit({
        organizationId:principal.organizationId,actorType:"user",actorId:principal.userId,
        action:"ledgerly_ai.approval.executed",entityType:"approval",entityId:approvalId,
        correlationId:"approval:"+approvalId,riskLevel:approval.riskLevel,
        metadata:{
          toolName:tool.name,toolCallId:approval.toolCallId,requestedBy:requester.userId,
          approvalCount,requiredApprovals:approval.requiredApprovals,
        },
      });
      return {
        id: approvalId, status: "executed", toolCallId: approval.toolCallId,
        approvalCount,requiredApprovals:approval.requiredApprovals,result: executed.result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.runtime.db.query(
        `UPDATE lai_approvals
            SET status='failed',execution_result_json=$1::jsonb,executed_at=CURRENT_TIMESTAMP
          WHERE id=$2 AND organization_id=$3`,
        [JSON.stringify({ error: message.slice(0, 4000) }),approvalId,principal.organizationId],
      );
      if (approval.jobId) {
        await this.runtime.db.query(
          `UPDATE lai_jobs
              SET status='failed',error_text=$1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
            WHERE id=$2 AND organization_id=$3 AND status='waiting_approval'`,
          [message.slice(0,4000),approval.jobId,principal.organizationId],
        );
        await this.runtime.db.query(
          `UPDATE lai_custom_agent_runs
              SET status='failed',error_text=$1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
            WHERE organization_id=$2 AND job_id=$3 AND status='waiting_approval'`,
          [message.slice(0,4000),principal.organizationId,approval.jobId],
        );
      }
      await this.policy.privilegedAudit({
        organizationId:principal.organizationId,actorType:"user",actorId:principal.userId,
        action:"ledgerly_ai.approval.execution_failed",entityType:"approval",entityId:approvalId,
        correlationId:"approval:"+approvalId,riskLevel:approval.riskLevel,
        metadata:{toolName:tool.name,error:message.slice(0,1000)},
      });
      throw error;
    }
  }

  async reject(principal: AuthPrincipal, approvalId: string, note?: string) {
    const approval = await this.approvalRow(principal, approvalId);
    if (approval.status !== "pending") {
      throw new AppError(409, "LEDGERLY_AI_APPROVAL_REVIEWED", "This approval has already been reviewed.");
    }
    if (!approval.toolName || !approval.toolCallId) {
      throw new AppError(409, "LEDGERLY_AI_APPROVAL_INVALID", "Approval is not linked to a Ledgerly AI tool call.");
    }
    const tool = this.registry.get(approval.toolName);
    const required = stringArray(approval.requiredScopes);
    if (!scopeSatisfied(principal, required, tool.scopeMode ?? "all")) {
      throw new AppError(403, "FORBIDDEN", "You do not hold the Ledgerly permissions required to review this action.");
    }
    const reviewerRole=approval.approvalPolicy?.reviewerRole==="owner"?"owner":"admin";
    this.policy.assertReviewer(principal,reviewerRole);
    const priorReview=await this.runtime.db.query(
      "SELECT decision FROM lai_approval_reviews WHERE approval_id=$1 AND organization_id=$2 AND reviewer_id=$3 LIMIT 1",
      [approvalId,principal.organizationId,principal.userId],
    );
    if(priorReview.rowCount){
      throw new AppError(409,"LEDGERLY_AI_APPROVAL_ALREADY_REVIEWED_BY_USER",
        "You have already reviewed this approval request.");
    }

    const reviewId=createId("laiar");
    const client=await this.runtime.db.connect();
    let rejected=false;
    try{
      await client.query("BEGIN");
      const locked=await client.query<{status:string}>(
        "SELECT status FROM lai_approvals WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [approvalId,principal.organizationId],
      );
      if(locked.rows[0]?.status!=="pending"){
        throw new AppError(409,"LEDGERLY_AI_APPROVAL_REVIEWED","Approval was reviewed by another request.");
      }
      await client.query(
        `INSERT INTO lai_approval_reviews(
          id,approval_id,organization_id,reviewer_id,decision,note,metadata_json
        ) VALUES($1,$2,$3,$4,'rejected',$5,$6::jsonb)`,
        [
          reviewId,approvalId,principal.organizationId,principal.userId,note?.slice(0,2000)??null,
          JSON.stringify({role:principal.role,approvalMode:approval.approvalMode}),
        ],
      );
      const reviewed=await client.query(
        `UPDATE lai_approvals SET status='rejected',reviewed_by=$1,review_note=$2,reviewed_at=CURRENT_TIMESTAMP
          WHERE id=$3 AND organization_id=$4 AND status='pending'
          RETURNING id`,
        [principal.userId,note??null,approvalId,principal.organizationId],
      );
      rejected=Boolean(reviewed.rowCount);
      if(rejected){
        await client.query(
          `UPDATE lai_tool_calls SET status='denied',error_text='Human approval rejected',
                  completed_at=CURRENT_TIMESTAMP
            WHERE id=$1 AND organization_id=$2 AND status='waiting_approval'`,
          [approval.toolCallId,principal.organizationId],
        );
        if (approval.jobId) {
          await client.query(
            `UPDATE lai_jobs SET status='cancelled',error_text='Human approval rejected',
                    completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
              WHERE id=$1 AND organization_id=$2 AND status='waiting_approval'`,
            [approval.jobId,principal.organizationId],
          );
          await client.query(
            `UPDATE lai_custom_agent_runs SET status='cancelled',error_text='Human approval rejected',
                    completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
              WHERE organization_id=$1 AND job_id=$2 AND status='waiting_approval'`,
            [principal.organizationId,approval.jobId],
          );
        }
      }
      await client.query("COMMIT");
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }finally{client.release();}

    if(!rejected){
      const current=await this.approvalRow(principal,approvalId);
      return{id:approvalId,status:current.status};
    }
    await this.audit({
      principal,
      action: "ledgerly_ai.tool.approval_rejected",
      entityType: "approval",
      entityId: approvalId,
      correlationId: "approval:" + approvalId,
      metadata: { toolName: approval.toolName, toolCallId: approval.toolCallId },
    });
    await this.policy.privilegedAudit({
      organizationId:principal.organizationId,actorType:"user",actorId:principal.userId,
      action:"ledgerly_ai.approval.rejected",entityType:"approval",entityId:approvalId,
      correlationId:"approval:"+approvalId,riskLevel:approval.riskLevel,
      metadata:{reviewId,toolName:approval.toolName,toolCallId:approval.toolCallId,note:note??null},
    });
    return { id: approvalId, status: "rejected" };
  }

  async toolCall(principal: AuthPrincipal, id: string) {
    const result = await this.runtime.db.query<ToolCallRow>(
      `SELECT id,organization_id AS "organizationId",job_id AS "jobId",chat_id AS "chatId",
              agent_id AS "agentId",requested_by AS "requestedBy",tool_name AS "toolName",
              arguments_json AS arguments,risk_level AS "riskLevel",status,
              correlation_id AS "correlationId",approval_id AS "approvalId"
         FROM lai_tool_calls WHERE id=$1 AND organization_id=$2`,
      [id,principal.organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "LEDGERLY_AI_TOOL_CALL_NOT_FOUND", "Ledgerly AI tool call not found.");
    if (!isAdmin(principal) && row.requestedBy !== principal.userId) {
      throw new AppError(403, "FORBIDDEN", "You cannot inspect another user's Ledgerly AI tool call.");
    }
    return row;
  }
}
