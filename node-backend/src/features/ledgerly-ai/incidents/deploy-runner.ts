import { spawn } from "node:child_process";
import type { LedgerlyAiConfig } from "../config.js";

type DeployResult = { ok: boolean; output: string; durationMs: number };

function run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); if (output.length > 200_000) output = output.slice(-200_000); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); if (output.length > 200_000) output = output.slice(-200_000); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, output, timedOut }); });
    child.on("error", (error) => { clearTimeout(timer); output += "\n" + String(error); resolve({ code: -1, output, timedOut }); });
  });
}

// Runs from the orchestrator (api/queue), which has the Docker socket and
// docker CLI — never from inside an isolated provider worker container.
// Deliberately narrow: only `build` and `up -d` on the configured service
// names, never `down`/`rm`/arbitrary compose subcommands.
export async function deployComposeServices(config: LedgerlyAiConfig): Promise<DeployResult> {
  const started = Date.now();
  const services = config.LEDGERLY_AI_DEPLOY_SERVICES.split(",").map((s) => s.trim()).filter(Boolean);
  if (!services.length) return { ok: false, output: "No deploy services configured.", durationMs: 0 };
  const cwd = config.LEDGERLY_AI_DEPLOY_COMPOSE_DIR;
  const timeoutMs = config.LEDGERLY_AI_DEPLOY_TIMEOUT_MS;

  const build = await run("docker", ["compose", "build", ...services], cwd, timeoutMs);
  if (build.timedOut) return { ok: false, output: build.output + "\n[build timed out]", durationMs: Date.now() - started };
  if (build.code !== 0) return { ok: false, output: build.output, durationMs: Date.now() - started };

  const up = await run("docker", ["compose", "up", "-d", ...services], cwd, timeoutMs);
  const ok = !up.timedOut && up.code === 0;
  return { ok, output: build.output + "\n" + up.output + (up.timedOut ? "\n[up timed out]" : ""), durationMs: Date.now() - started };
}
