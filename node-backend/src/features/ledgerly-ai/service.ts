import type { Runtime } from "../../runtime.js";
import { parseLedgerlyAiConfig, type LedgerlyAiConfig } from "./config.js";
import { LedgerlyAiEmployeeRegistry } from "./employees/registry.js";
import { LedgerlyAiGatewayRepository } from "./gateway/repository.js";
import { LedgerlyAiGatewayService } from "./gateway/service.js";
import { createLedgerlyAiLogger, type LedgerlyAiLogger } from "./logger.js";
import { LedgerlyAiMemoryService } from "./memory/service.js";
import { LedgerlyAiProviderRuntime } from "./providers/runtime.js";
import { LedgerlyAiToolService } from "./tools/service.js";
import { LedgerlyAiForgeService } from "./forge/service.js";
import { LedgerlyAiCustomRuntimeService } from "./custom-runtime/service.js";
import { LedgerlyAiIncidentService } from "./incidents/service.js";
import { LedgerlyAiGitService } from "./git/service.js";
import { LedgerlyAiMonitoringService } from "./monitoring/service.js";
import { LedgerlyAiPolicyService } from "./policy/service.js";
import { LedgerlyAiConsoleService } from "./console/service.js";
import { LedgerlyAiSecurityService } from "./security/service.js";

export type LedgerlyAiHealth = {
  name: "Ledgerly AI";
  enabled: boolean;
  status: "ok" | "degraded" | "disabled";
  ready: boolean;
  startedAt: string;
  checkedAt: string;
  components: {
    config: { status: "ok" | "error" };
    postgres: { status: "ok" | "error"; latencyMs: number; error?: string };
    schema: { status: "ok" | "error"; latencyMs: number; error?: string };
    providerPool: { status: "ok" | "error"; available: number; configured: number };
  };
};

export class LedgerlyAiFoundationService {
  readonly config: LedgerlyAiConfig;
  readonly startedAt = new Date().toISOString();
  readonly providers: LedgerlyAiProviderRuntime;
  readonly repository: LedgerlyAiGatewayRepository;
  readonly employees: LedgerlyAiEmployeeRegistry;
  readonly memory: LedgerlyAiMemoryService;
  readonly security: LedgerlyAiSecurityService;
  readonly policy: LedgerlyAiPolicyService;
  readonly tools: LedgerlyAiToolService;
  readonly gateway: LedgerlyAiGatewayService;
  readonly forge: LedgerlyAiForgeService;
  readonly customRuntime: LedgerlyAiCustomRuntimeService;
  readonly incidents: LedgerlyAiIncidentService;
  readonly git: LedgerlyAiGitService;
  readonly monitoring: LedgerlyAiMonitoringService;
  readonly console: LedgerlyAiConsoleService;
  private readonly logger: LedgerlyAiLogger;
  private startPromise: Promise<void> | null = null;

  constructor(
    private readonly runtime: Runtime,
    env: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
  ) {
    this.config = parseLedgerlyAiConfig(env);
    this.logger = createLedgerlyAiLogger(runtime.logger);
    this.providers = new LedgerlyAiProviderRuntime(runtime, this.config);
    this.repository = new LedgerlyAiGatewayRepository(runtime.db);
    this.employees = new LedgerlyAiEmployeeRegistry(runtime.db);
    this.memory = new LedgerlyAiMemoryService(runtime.db, this.repository, this.config);
    this.security = new LedgerlyAiSecurityService(runtime);
    this.policy = new LedgerlyAiPolicyService(runtime);
    this.tools = new LedgerlyAiToolService(runtime, this.config, this.employees, this.policy, this.security);
    this.forge = new LedgerlyAiForgeService(
      runtime.db,
      this.config,
      this.employees,
      this.repository,
      this.providers,
      this.memory,
      this.tools,
    );
    this.gateway = new LedgerlyAiGatewayService(
      this.repository,
      this.providers,
      this.memory,
      this.employees,
      this.tools,
      this.security,
      this.config,
      runtime.db,
      this.logger,
    );
    this.customRuntime = new LedgerlyAiCustomRuntimeService(runtime,this.employees,this.gateway,this.policy);
    this.git = new LedgerlyAiGitService(runtime,this.config);
    this.incidents = new LedgerlyAiIncidentService(runtime,this.config,this.providers,this.employees,this.logger,this.git,this.policy);
    this.monitoring = new LedgerlyAiMonitoringService(runtime,this.config,this.incidents,this.git);
    this.console = new LedgerlyAiConsoleService(runtime,this);
    this.logger.info(
      {
        enabled: this.config.LEDGERLY_AI_ENABLED,
        executionMode: this.config.LEDGERLY_AI_EXECUTION_MODE,
        maxConcurrency: this.config.LEDGERLY_AI_MAX_CONCURRENCY,
        startupHealthcheck: this.config.LEDGERLY_AI_STARTUP_HEALTHCHECK,
      },
      "Ledgerly AI initialized",
    );
  }

  start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.providers.initialize()
      .then(async () => {
        if (!this.config.LEDGERLY_AI_STARTUP_HEALTHCHECK) return;
        const health = await this.health();
        if (health.ready) this.logger.info({ health }, "Ledgerly AI startup health check passed");
        else this.logger.warn({ health }, "Ledgerly AI startup health check is degraded");
      })
      .catch((error) => {
        this.startPromise = null;
        this.logger.error({ err: error }, "Ledgerly AI startup failed");
        throw error;
      });
    return this.startPromise;
  }

  async health(): Promise<LedgerlyAiHealth> {
    const disabled = !this.config.LEDGERLY_AI_ENABLED;
    const postgresStarted = performance.now();
    let postgres: LedgerlyAiHealth["components"]["postgres"];
    try {
      await this.runtime.db.query("SELECT 1");
      postgres = { status: "ok", latencyMs: Math.round(performance.now() - postgresStarted) };
    } catch (error) {
      postgres = {
        status: "error",
        latencyMs: Math.round(performance.now() - postgresStarted),
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const schemaStarted = performance.now();
    let schema: LedgerlyAiHealth["components"]["schema"];
    try {
      const result = await this.runtime.db.query<{
        chats: string | null;
        audit: string | null;
        memories: string | null;
        memoryAudit: string | null;
        agentTemplates: string | null;
        toolCalls: string | null;
        approvals: string | null;
        builderSessions: string | null;
        agentVersions: string | null;
        customShares: string | null;
        customTriggers: string | null;
        customRuns: string | null;
        customEvents: string | null;
        incidentEvents: string | null;
        incidentChecks: string | null;
        incidentDeployments: string | null;
        gitWorkspaces: string | null;
        gitCommits: string | null;
        gitPullRequests: string | null;
        gitCiChecks: string | null;
        monitorSamples: string | null;
        monitorState: string | null;
        monitorSummaries: string | null;
        policyRules: string | null;
        aiControls: string | null;
        privilegedAudit: string | null;
        approvalReviews: string | null;
      }>(
        `SELECT
           to_regclass('public.lai_chats')::text AS chats,
           to_regclass('public.lai_audit_events')::text AS audit,
           to_regclass('public.lai_memories')::text AS memories,
           to_regclass('public.lai_memory_audit')::text AS "memoryAudit",
           to_regclass('public.lai_agent_templates')::text AS "agentTemplates",
           to_regclass('public.lai_tool_calls')::text AS "toolCalls",
           to_regclass('public.lai_approvals')::text AS approvals,
           to_regclass('public.lai_agent_builder_sessions')::text AS "builderSessions",
           to_regclass('public.lai_agent_versions')::text AS "agentVersions",
           to_regclass('public.lai_custom_agent_shares')::text AS "customShares",
           to_regclass('public.lai_custom_agent_triggers')::text AS "customTriggers",
           to_regclass('public.lai_custom_agent_runs')::text AS "customRuns",
           to_regclass('public.lai_custom_agent_events')::text AS "customEvents",
           to_regclass('public.lai_incident_events')::text AS "incidentEvents",
           to_regclass('public.lai_incident_checks')::text AS "incidentChecks",
           to_regclass('public.lai_incident_deployments')::text AS "incidentDeployments",
           to_regclass('public.lai_git_workspaces')::text AS "gitWorkspaces",
           to_regclass('public.lai_git_commits')::text AS "gitCommits",
           to_regclass('public.lai_git_pull_requests')::text AS "gitPullRequests",
           to_regclass('public.lai_git_ci_checks')::text AS "gitCiChecks",
           to_regclass('public.lai_monitor_samples')::text AS "monitorSamples",
           to_regclass('public.lai_monitor_state')::text AS "monitorState",
           to_regclass('public.lai_monitor_summaries')::text AS "monitorSummaries",
           to_regclass('public.lai_policy_rules')::text AS "policyRules",
           to_regclass('public.lai_ai_controls')::text AS "aiControls",
           to_regclass('public.lai_privileged_audit')::text AS "privilegedAudit",
           to_regclass('public.lai_approval_reviews')::text AS "approvalReviews"`,
      );
      const row = result.rows[0];
      schema = !row?.chats || !row.audit || !row.memories || !row.memoryAudit
        || !row.agentTemplates || !row.toolCalls || !row.approvals || !row.builderSessions || !row.agentVersions
        || !row.customShares || !row.customTriggers || !row.customRuns || !row.customEvents
        || !row.incidentEvents || !row.incidentChecks || !row.incidentDeployments
        || !row.gitWorkspaces || !row.gitCommits || !row.gitPullRequests || !row.gitCiChecks
        || !row.monitorSamples || !row.monitorState || !row.monitorSummaries
        || !row.policyRules || !row.aiControls || !row.privilegedAudit || !row.approvalReviews
        ? {
            status: "error",
            latencyMs: Math.round(performance.now() - schemaStarted),
            error: "Ledgerly AI database migrations are not fully applied.",
          }
        : { status: "ok", latencyMs: Math.round(performance.now() - schemaStarted) };
    } catch (error) {
      schema = {
        status: "error",
        latencyMs: Math.round(performance.now() - schemaStarted),
        error: error instanceof Error ? error.message : String(error),
      };
    }

    let providerPool: LedgerlyAiHealth["components"]["providerPool"];
    try {
      const diagnostics = await this.providers.diagnostics();
      const available = diagnostics.filter((item) => item.available).length;
      const configured = diagnostics.filter((item) => item.sessionConfigured).length;
      providerPool = { status: available > 0 ? "ok" : "error", available, configured };
    } catch {
      providerPool = { status: "error", available: 0, configured: 0 };
    }

    const ready = disabled ? false : postgres.status === "ok" && schema.status === "ok" && providerPool.status === "ok";
    return {
      name: "Ledgerly AI",
      enabled: !disabled,
      status: disabled ? "disabled" : ready ? "ok" : "degraded",
      ready,
      startedAt: this.startedAt,
      checkedAt: new Date().toISOString(),
      components: { config: { status: "ok" }, postgres, schema, providerPool },
    };
  }
}
