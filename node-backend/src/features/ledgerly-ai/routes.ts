import { Hono } from "hono";
import type { AppEnv } from "../../http/types.js";
import { requireScope } from "../core-identity/security.js";
import {
  createLedgerlyAiEmployeeAdminRoutes,
  createLedgerlyAiEmployeeRoutes,
} from "./employees/routes.js";
import { createLedgerlyAiGatewayRoutes } from "./gateway/routes.js";
import {
  createLedgerlyAiMemoryAdminRoutes,
  createLedgerlyAiMemoryRoutes,
} from "./memory/routes.js";
import type { LedgerlyAiFoundationService } from "./service.js";
import { createLedgerlyAiForgeRoutes } from "./forge/routes.js";
import { createLedgerlyAiCustomRuntimeRoutes } from "./custom-runtime/routes.js";
import { createLedgerlyAiIncidentRoutes } from "./incidents/routes.js";
import { createLedgerlyAiGitRoutes } from "./git/routes.js";
import { createLedgerlyAiMonitoringRoutes } from "./monitoring/routes.js";
import { createLedgerlyAiPolicyRoutes } from "./policy/routes.js";
import { createLedgerlyAiConsoleRoutes } from "./console/routes.js";
import {
  createLedgerlyAiApprovalRoutes,
  createLedgerlyAiToolRoutes,
} from "./tools/routes.js";

export function createLedgerlyAiRoutes(service: LedgerlyAiFoundationService) {
  const routes = new Hono<AppEnv>();

  routes.get("/health", async (c) => {
    const health = await service.health();
    return c.json({ data: health }, health.status === "degraded" ? 503 : 200);
  });

  routes.get("/ready", async (c) => {
    const health = await service.health();
    return c.json(
      { data: { name: health.name, enabled: health.enabled, ready: health.ready, status: health.status, checkedAt: health.checkedAt } },
      health.ready ? 200 : 503,
    );
  });

  routes.get("/meta", (c) =>
    c.json({
      data: {
        name: "Ledgerly AI",
        featureVersion: "0.18.0",
        enabled: service.config.LEDGERLY_AI_ENABLED,
        providerSelection: "managed",
        memory: true,
        namedEmployees: true,
        tools: true,
        approvals: true,
        legacyEmployeesIntegrated: true,
        forgeAgentBuilder: true,
        customAgentRuntime: true,
        engineeringIncidents: true,
        governedGitWorkflow: true,
        autonomousMonitoring: true,
        policyAndApprovals: true,
        adminConsole: true,
        endUserWorkspace: true,
        securityIsolation: true,
        reliabilityTesting: true,
        documentationOperations: true,
      },
    }),
  );

  routes.get("/internal/providers", requireScope("admin:read"), async (c) => {
    const diagnostics = await service.providers.diagnostics();
    return c.json({
      data: {
        executionMode: service.config.LEDGERLY_AI_EXECUTION_MODE,
        queue: { active: service.providers.queue.active, queued: service.providers.queue.queued },
        providers: diagnostics,
      },
    });
  });

  routes.route("/internal/employees", createLedgerlyAiEmployeeAdminRoutes(service.employees));
  routes.route("/internal/memories", createLedgerlyAiMemoryAdminRoutes(service.memory));
  routes.route("/employees", createLedgerlyAiEmployeeRoutes(service.employees));
  routes.route("/memories", createLedgerlyAiMemoryRoutes(service.memory));
  routes.route("/tools", createLedgerlyAiToolRoutes(service.tools, service.employees));
  routes.route("/approvals", createLedgerlyAiApprovalRoutes(service.tools));
  routes.route("/forge", createLedgerlyAiForgeRoutes(service.forge));
  routes.route("/custom-agents", createLedgerlyAiCustomRuntimeRoutes(service.customRuntime));
  routes.route("/incidents", createLedgerlyAiIncidentRoutes(service.incidents));
  routes.route("/git", createLedgerlyAiGitRoutes(service.git));
  routes.route("/monitoring", createLedgerlyAiMonitoringRoutes(service.monitoring));
  routes.route("/policy", createLedgerlyAiPolicyRoutes(service.policy));
  routes.route("/console", createLedgerlyAiConsoleRoutes(service.console));
  routes.route("/", createLedgerlyAiGatewayRoutes(service.repository, service.gateway, service.employees));
  return routes;
}
