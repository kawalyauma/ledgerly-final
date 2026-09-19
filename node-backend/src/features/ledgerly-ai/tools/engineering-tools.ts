import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import type { LedgerlyAiToolDefinition } from "./types.js";
import { redactLedgerlyAiText } from "../gateway/redaction.js";
import { assertLedgerlyAiCommandAllowed } from "../security/command-policy.js";

type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

function safeRelative(value: string | undefined) {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (path.isAbsolute(v) || v.includes("..") || /[\r\n\0]/.test(v)) {
    throw new Error("Repository path must be a safe relative path.");
  }
  return v;
}

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    assertLedgerlyAiCommandAllowed(command,args);
    const started = Date.now();
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG,LC_ALL:process.env.LC_ALL,
        GIT_TERMINAL_PROMPT:"0",CI:"1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let settled = false;
    const capture = (kind: "stdout" | "stderr", chunk: Buffer) => {
      if (bytes >= maxBytes) return;
      const text = redactLedgerlyAiText(chunk.toString("utf8"));
      const remaining = maxBytes - bytes;
      const sliced = Buffer.from(text).subarray(0, remaining).toString("utf8");
      bytes += Buffer.byteLength(sliced);
      if (kind === "stdout") stdout += sliced;
      else stderr += sliced;
    };
    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk));
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 3000).unref();
    }, timeoutMs);
    timer.unref();
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

function commandSchema(properties: Record<string, unknown> = {}, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

async function requireSuccess(result: RunResult, operation: string) {
  if (result.exitCode !== 0) {
    throw new Error(operation + " failed: " + (result.stderr.trim() || result.stdout.trim() || "unknown error"));
  }
  return result;
}

const repoSearch: LedgerlyAiToolDefinition = {
  name: "repo.search",
  category: "repository",
  description: "Search tracked Ledgerly source text using git grep. Read-only; no arbitrary shell.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(300),
    path: z.string().max(300).optional(),
    maxResults: z.number().int().min(1).max(200).default(100),
  }),
  inputJsonSchema: commandSchema({
    query: { type: "string" },
    path: { type: "string", description: "Optional safe relative repository path." },
    maxResults: { type: "integer", minimum: 1, maximum: 200 },
  }, ["query"]),
  requiredScopes: ["admin:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const rel = safeRelative(input.path);
    const args = ["grep","-n","-I","-e",input.query,"--"];
    if (rel) args.push(rel);
    const result = await run("git", args, ctx.config.LEDGERLY_AI_REPO_ROOT, ctx.config.LEDGERLY_AI_TOOL_TIMEOUT_MS, ctx.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES);
    if (result.exitCode !== 0 && result.exitCode !== 1) await requireSuccess(result, "Repository search");
    const lines = result.stdout.split("\n").filter(Boolean).slice(0, input.maxResults);
    return { matches: lines, count: lines.length, truncated: result.stdout.split("\n").filter(Boolean).length > lines.length };
  },
};

const repoStatus: LedgerlyAiToolDefinition = {
  name: "repo.status",
  category: "repository",
  description: "Inspect current Git branch and working-tree status without modifying it.",
  inputSchema: z.object({}),
  inputJsonSchema: commandSchema(),
  requiredScopes: ["admin:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx) {
    const [status, branch] = await Promise.all([
      run("git", ["status","--short","--branch"], ctx.config.LEDGERLY_AI_REPO_ROOT, ctx.config.LEDGERLY_AI_TOOL_TIMEOUT_MS, ctx.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES),
      run("git", ["rev-parse","--abbrev-ref","HEAD"], ctx.config.LEDGERLY_AI_REPO_ROOT, ctx.config.LEDGERLY_AI_TOOL_TIMEOUT_MS, 8192),
    ]);
    await requireSuccess(status, "Git status");
    await requireSuccess(branch, "Git branch");
    return { branch: branch.stdout.trim(), status: status.stdout.trim() };
  },
};

const repoDiff: LedgerlyAiToolDefinition = {
  name: "repo.diff",
  category: "repository",
  description: "Inspect a bounded Git diff for the Ledgerly repository without modifying files.",
  inputSchema: z.object({
    path: z.string().max(300).optional(),
    staged: z.boolean().default(false),
  }),
  inputJsonSchema: commandSchema({
    path: { type: "string" },
    staged: { type: "boolean" },
  }),
  requiredScopes: ["admin:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const rel = safeRelative(input.path);
    const args = ["diff", ...(input.staged ? ["--cached"] : []), "--stat"];
    if (rel) args.push("--", rel);
    const result = await run("git", args, ctx.config.LEDGERLY_AI_REPO_ROOT, ctx.config.LEDGERLY_AI_TOOL_TIMEOUT_MS, ctx.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES);
    await requireSuccess(result, "Git diff");
    return { staged: input.staged, path: rel || null, stat: result.stdout.trim() };
  },
};

const scriptSchema = z.object({
  target: z.enum(["node-backend"]).default("node-backend"),
});
function packageDir(root: string, target: "node-backend") {
  return path.join(root, target);
}

const testRun: LedgerlyAiToolDefinition = {
  name: "test.run",
  category: "testing",
  description: "Run the fixed Ledgerly Node backend test suite. Does not accept arbitrary commands.",
  inputSchema: scriptSchema,
  inputJsonSchema: commandSchema({ target: { type: "string", enum: ["node-backend"] } }),
  requiredScopes: ["admin:write"],
  riskLevel: "medium",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const result = await run("npm", ["test"], packageDir(ctx.config.LEDGERLY_AI_REPO_ROOT, input.target), ctx.config.LEDGERLY_AI_TOOL_TIMEOUT_MS, ctx.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES);
    return { ...(await requireSuccess(result, "Test run")), stdout: result.stdout.slice(-ctx.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES) };
  },
};

const buildRun: LedgerlyAiToolDefinition = {
  name: "build.run",
  category: "testing",
  description: "Run the fixed strict Node backend TypeScript build. Does not accept arbitrary commands.",
  inputSchema: scriptSchema,
  inputJsonSchema: commandSchema({ target: { type: "string", enum: ["node-backend"] } }),
  requiredScopes: ["admin:write"],
  riskLevel: "medium",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const result = await run("npm", ["run","build:strict"], packageDir(ctx.config.LEDGERLY_AI_REPO_ROOT, input.target), ctx.config.LEDGERLY_AI_TOOL_TIMEOUT_MS, ctx.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES);
    return await requireSuccess(result, "Strict build");
  },
};

const dockerHealth: LedgerlyAiToolDefinition = {
  name: "docker.health",
  category: "operations",
  description: "Inspect Docker container names, status, health and image without modifying containers.",
  inputSchema: z.object({}),
  inputJsonSchema: commandSchema(),
  requiredScopes: ["admin:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx) {
    const result = await run(
      ctx.config.LEDGERLY_AI_DOCKER_BIN,
      ["ps","-a","--format","{{json .}}"],
      ctx.config.LEDGERLY_AI_REPO_ROOT,
      ctx.config.LEDGERLY_AI_TOOL_TIMEOUT_MS,
      ctx.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES,
    );
    await requireSuccess(result, "Docker health");
    const containers = result.stdout.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
    return { containers };
  },
};

const logsRead: LedgerlyAiToolDefinition = {
  name: "logs.read",
  category: "operations",
  description: "Read recent Docker logs for a fixed Ledgerly service. Does not execute commands inside containers.",
  inputSchema: z.object({
    service: z.enum(["api","queue","scheduler","postgres","redis"]),
    tail: z.number().int().min(1).max(500).default(100),
  }),
  inputJsonSchema: commandSchema({
    service: { type: "string", enum: ["api","queue","scheduler","postgres","redis"] },
    tail: { type: "integer", minimum: 1, maximum: 500 },
  }, ["service"]),
  requiredScopes: ["admin:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx, input) {
    const lookup = await run(
      ctx.config.LEDGERLY_AI_DOCKER_BIN,
      ["ps","-a","--filter","label=com.docker.compose.service=" + input.service,"--format","{{.ID}}"],
      ctx.config.LEDGERLY_AI_REPO_ROOT,
      ctx.config.LEDGERLY_AI_TOOL_TIMEOUT_MS,
      16384,
    );
    await requireSuccess(lookup, "Docker service lookup");
    const id = lookup.stdout.split("\n").map((v) => v.trim()).find(Boolean);
    if (!id) return { service: input.service, found: false, logs: "" };
    const result = await run(
      ctx.config.LEDGERLY_AI_DOCKER_BIN,
      ["logs","--tail",String(input.tail),id],
      ctx.config.LEDGERLY_AI_REPO_ROOT,
      ctx.config.LEDGERLY_AI_TOOL_TIMEOUT_MS,
      ctx.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES,
    );
    await requireSuccess(result, "Docker logs");
    return { service: input.service, found: true, logs: (result.stdout + result.stderr).slice(-ctx.config.LEDGERLY_AI_TOOL_MAX_RESULT_BYTES) };
  },
};

const serviceHealth: LedgerlyAiToolDefinition = {
  name: "service.health",
  category: "operations",
  description: "Check Ledgerly PostgreSQL, Redis and object storage runtime health.",
  inputSchema: z.object({}),
  inputJsonSchema: commandSchema(),
  requiredScopes: ["admin:read"],
  riskLevel: "low",
  approvalRequired: false,
  mutating: false,
  async execute(ctx) {
    const started = Date.now();
    const components: Record<string, unknown> = {};
    try {
      await ctx.runtime.db.query("SELECT 1");
      components.postgres = { status: "ok" };
    } catch (error) {
      components.postgres = { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
    try {
      const pong = await ctx.runtime.cache.ping();
      components.redis = { status: pong === "PONG" ? "ok" : "error" };
    } catch (error) {
      components.redis = { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
    try {
      await ctx.runtime.storage.healthcheck();
      components.storage = { status: "ok" };
    } catch (error) {
      components.storage = { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
    return { checkedAt: new Date().toISOString(), durationMs: Date.now() - started, components };
  },
};

export const engineeringTools: LedgerlyAiToolDefinition[] = [
  repoSearch,repoStatus,repoDiff,testRun,buildRun,dockerHealth,logsRead,serviceHealth,
];
