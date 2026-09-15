import { createId } from "../../../src/lib/ids";
import type { Env } from "../../../src/types";
import {
  executeTool as baseExecute,
  openAiTools as baseTools,
} from "./tools-v15";
import type { ToolContext } from "./tools-v14";

const NAMES = [
  "system_catalog",
  "system_read",
  "prepare_system_action",
] as const;

type SystemTool = typeof NAMES[number];

const SPECS: Record<SystemTool, any> = {
  system_catalog: {
    type: "function",
    name: "system_catalog",
    strict: false,
    description:
      "List the real Ledgerly API operations available to this employee role. " +
      "Use this before unfamiliar reads or writes. Never invent API routes.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      additionalProperties: false,
    },
  },

  system_read: {
    type: "function",
    name: "system_read",
    strict: false,
    description:
      "Perform a read-only GET against a REAL permitted Ledgerly API route. " +
      "The route is checked against the live Ledgerly route catalog before execution.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Absolute Ledgerly API path beginning /api/v1/. " +
            "Use system_catalog instead of guessing routes.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },

  prepare_system_action: {
    type: "function",
    name: "prepare_system_action",
    strict: false,
    description:
      "Prepare ONE role-scoped Ledgerly mutation for inline confirmation in the current chat. " +
      "The method and path are validated against Ledgerly's live route catalog before the " +
      "confirmation can be created. Never invent API routes. Use system_catalog first when " +
      "the route is unfamiliar. The title and summary are shown to the user, so include real " +
      "names, amounts, dates, classes, subjects, terms and counts whenever known. Never invent " +
      "required school data just to satisfy an API request; ask the user when an essential " +
      "business value is missing.",
    parameters: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["POST", "PUT", "PATCH", "DELETE"],
        },
        path: {
          type: "string",
          description:
            "A real route returned by system_catalog. Do not guess.",
        },
        bodyJson: {
          type: "string",
          description:
            "JSON request body. Use {} for DELETE or requests without fields.",
        },
        title: { type: "string" },
        summary: { type: "string" },
      },
      required: [
        "method",
        "path",
        "bodyJson",
        "title",
        "summary",
      ],
      additionalProperties: false,
    },
  },
};

function sameSet(
  a: readonly string[],
  b: readonly string[],
) {
  return (
    a.length === b.length &&
    a.every(x => b.includes(x))
  );
}

function allowed(
  agent: any,
  name: SystemTool,
  requested?: string[] | null,
) {
  if (!agent.tools.includes(name)) return false;
  if (!requested) return true;
  if (requested.includes(name)) return true;

  const legacy = agent.tools.filter(
    (x: string) => !NAMES.includes(x as SystemTool),
  );

  return sameSet(requested, legacy);
}

function hash(value: string) {
  let h = 2166136261;

  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return (h >>> 0).toString(16);
}

function scopeFor(path: string) {
  const p = path.toLowerCase();

  if (p.includes("/accounts")) return "accounts:write";
  if (p.includes("/journals")) return "journals:write";
  if (p.includes("/reports")) return "reports:write";
  if (p.includes("/contacts")) return "contacts:write";

  if (
    p.includes("/documents") ||
    p.includes("/files")
  ) {
    return "documents:write";
  }

  if (
    p.includes("/payments") ||
    p.includes("/banking")
  ) {
    return "payments:write";
  }

  if (p.includes("/payroll")) return "payroll:write";

  if (p.includes("/communications")) {
    return "communications:write";
  }

  if (
    p.includes("/products") ||
    p.includes("/inventory")
  ) {
    return "products:write";
  }

  return "school:write";
}

function cleanPath(value: string) {
  const path = String(value || "")
    .trim()
    .split("?")[0]
    .replace(/\/+$/, "");

  return path || "/";
}

/*
 * Compatibility aliases are deliberately narrow.
 * They repair previously generated AI paths without turning
 * Ledgerly into a permissive catch-all router.
 */
function normalizeKnownAlias(
  method: string,
  originalPath: string,
) {
  const path = cleanPath(originalPath);

  if (
    (method === "POST" || method === "GET") &&
    path === "/api/v1/staff"
  ) {
    return "/api/v1/school/staff-management/staff";
  }

  if (
    path.startsWith("/api/v1/staff/")
  ) {
    return (
      "/api/v1/school/staff-management/staff/" +
      path.slice("/api/v1/staff/".length)
    );
  }

  return path;
}

function routeMatches(
  templatePath: string,
  requestedPath: string,
) {
  const expected = cleanPath(templatePath)
    .split("/")
    .filter(Boolean);

  const actual = cleanPath(requestedPath)
    .split("/")
    .filter(Boolean);

  if (expected.length !== actual.length) {
    return false;
  }

  return expected.every((part, index) => {
    const supplied = actual[index] || "";

    return (
      part === supplied ||
      part.startsWith(":") ||
      /^\{\{.+\}\}$/.test(supplied)
    );
  });
}

function relatedRoutes(
  routes: any[],
  method: string,
  path: string,
) {
  const words = cleanPath(path)
    .toLowerCase()
    .split("/")
    .filter(part =>
      part &&
      !["api", "v1"].includes(part)
    );

  return routes
    .filter(route =>
      String(route.method || "").toUpperCase() === method
    )
    .map(route => {
      const candidate = String(route.path || "");
      const lower = candidate.toLowerCase();

      const score = words.reduce(
        (total, word) =>
          total + (lower.includes(word) ? 1 : 0),
        0,
      );

      return { ...route, score };
    })
    .filter(route => route.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function validateCatalogRoute(
  env: Env,
  agentKey: string,
  principal: any,
  method: string,
  rawPath: string,
) {
  if (!env.AGENT_SYSTEM_GATEWAY) {
    throw new Error(
      "The self-hosted delegated system gateway is not available",
    );
  }

  const path = normalizeKnownAlias(
    method,
    rawPath,
  );

  const routes = await env.AGENT_SYSTEM_GATEWAY.catalog(
    agentKey,
    principal,
  );

  const found = routes.find(route =>
    String(route.method || "").toUpperCase() === method &&
    routeMatches(String(route.path || ""), path)
  );

  if (found) {
    return {
      path,
      catalogPath: String(found.path),
      corrected: cleanPath(rawPath) !== path,
    };
  }

  const related = relatedRoutes(
    routes,
    method,
    path,
  );

  const suggestions = related.length
    ? related
        .map(route =>
          `${String(route.method).toUpperCase()} ${route.path}`
        )
        .join("; ")
    : "No related permitted routes were found.";

  throw new Error(
    `Ledgerly route ${method} ${path} does not exist in ` +
    `this employee's permitted live route catalog. ` +
    `Use system_catalog and retry with a real route. ` +
    `Related routes: ${suggestions}`,
  );
}

export function openAiTools(
  agent: any,
  requested?: string[] | null,
) {
  return [
    ...baseTools(agent, requested),
    ...NAMES
      .filter(name =>
        allowed(agent, name, requested)
      )
      .map(name => SPECS[name]),
  ];
}

export async function executeTool(
  ctx: ToolContext & { env?: Env },
  name: string,
  raw: unknown,
) {
  if (!NAMES.includes(name as SystemTool)) {
    return baseExecute(ctx, name, raw);
  }

  if (
    !allowed(
      ctx.agent,
      name as SystemTool,
      ctx.requestedTools,
    )
  ) {
    throw new Error(
      `${name} is not enabled for this employee`,
    );
  }

  const env = ctx.env as Env | undefined;

  if (!env?.AGENT_SYSTEM_GATEWAY) {
    throw new Error(
      "The self-hosted delegated system gateway is not available",
    );
  }

  const args =
    raw && typeof raw === "object"
      ? raw as Record<string, unknown>
      : {};

  if (name === "system_catalog") {
    const routes =
      await env.AGENT_SYSTEM_GATEWAY.catalog(
        ctx.agent.key,
        ctx.principal,
      );

    const q = String(args.query || "")
      .trim()
      .toLowerCase();

    return {
      role: ctx.agent.key,
      routes: (
        q
          ? routes.filter(route =>
              `${route.method} ${route.path}`
                .toLowerCase()
                .includes(q)
            )
          : routes
      ).slice(0, 250),
    };
  }

  if (name === "system_read") {
    const rawPath = String(
      args.path || "",
    ).trim();

    if (!rawPath.startsWith("/api/v1/")) {
      throw new Error(
        "A valid /api/v1/ Ledgerly path is required",
      );
    }

    const validated =
      await validateCatalogRoute(
        env,
        ctx.agent.key,
        ctx.principal,
        "GET",
        rawPath,
      );

    const result =
      await env.AGENT_SYSTEM_GATEWAY.request({
        agentKey: ctx.agent.key,
        principal: ctx.principal,
        method: "GET",
        path: validated.path,
      });

    if (!result.ok) {
      throw new Error(
        `Ledgerly API ${result.status}: ` +
        JSON.stringify(result.data).slice(0, 1200),
      );
    }

    return result.data;
  }

  const method = String(
    args.method || "",
  ).toUpperCase() as
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE";

  const rawPath = String(
    args.path || "",
  ).trim();

  const title = String(
    args.title || "Ledgerly action",
  ).trim().slice(0, 200);

  const summary = String(
    args.summary || "",
  ).trim().slice(0, 1000);

  if (
    !["POST", "PUT", "PATCH", "DELETE"]
      .includes(method) ||
    !rawPath.startsWith("/api/v1/")
  ) {
    throw new Error(
      "A valid Ledgerly API method and /api/v1/ path are required",
    );
  }

  const validated =
    await validateCatalogRoute(
      env,
      ctx.agent.key,
      ctx.principal,
      method,
      rawPath,
    );

  let body: unknown = {};

  try {
    body = JSON.parse(
      String(args.bodyJson || "{}"),
    );
  } catch {
    throw new Error(
      "bodyJson must be valid JSON",
    );
  }

  const payload = {
    agentKey: ctx.agent.key,
    method,
    path: validated.path,
    body,
  };

  const key =
    `conversation:${ctx.conversationId}:system:` +
    `${method}:${validated.path}:` +
    hash(JSON.stringify(body));

  const id = createId("aea");

  await ctx.db.prepare(`
    INSERT INTO ae_actions(
      id,
      organization_id,
      agent_key,
      action_type,
      title,
      summary,
      required_scope,
      payload_json,
      idempotency_key,
      status
    )
    VALUES(?,?,?,?,?,?,?,?,?,'suggested')
    ON CONFLICT(organization_id,idempotency_key)
    DO NOTHING
  `).bind(
    id,
    ctx.principal.organizationId,
    ctx.agent.key,
    "system.api.request",
    title,
    summary || `${method} ${validated.path}`,
    scopeFor(validated.path),
    JSON.stringify(payload),
    key,
  ).run();

  const action = await ctx.db.prepare(`
    SELECT
      id,
      status,
      title,
      action_type AS actionType,
      required_scope AS requiredScope
    FROM ae_actions
    WHERE organization_id=? AND idempotency_key=?
  `).bind(
    ctx.principal.organizationId,
    key,
  ).first();

  return {
    prepared: true,
    executed: false,
    requiresHumanConfirmation: true,
    routeValidated: true,
    correctedLegacyPath: validated.corrected,
    path: validated.path,
    action,
  };
}
