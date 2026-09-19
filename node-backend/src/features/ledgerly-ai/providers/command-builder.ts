import path from "node:path";
import type { LedgerlyAiConfig, LedgerlyAiProviderId } from "../config.js";
import type { LedgerlyAiSandbox } from "./types.js";
import { ProviderSessionStore } from "./session.js";

function ensureInside(root:string,candidate:string){
  const resolvedRoot=path.resolve(root)+path.sep;
  const resolved=path.resolve(candidate);
  if(!(resolved+path.sep).startsWith(resolvedRoot)){
    throw new Error("Ledgerly AI provider workspace escaped the configured work root.");
  }
  return resolved;
}

export type ProviderCommand = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export class ProviderCommandBuilder {
  constructor(
    private readonly config: LedgerlyAiConfig,
    private readonly sessions: ProviderSessionStore,
  ) {}

  build(provider: LedgerlyAiProviderId, cliArgs: string[], workspacePath: string, sandbox: LedgerlyAiSandbox): ProviderCommand {
    const env = this.sessions.environment(provider);
    const safeWorkspace=ensureInside(this.config.LEDGERLY_AI_WORK_ROOT,workspacePath);
    if (this.config.LEDGERLY_AI_EXECUTION_MODE === "local") {
      if (sandbox === "workspace-write") {
        throw new Error("Ledgerly AI workspace-write execution requires Docker isolation.");
      }
      return {
        command: provider === "codex" ? this.config.LEDGERLY_AI_CODEX_BIN : this.config.LEDGERLY_AI_CLAUDE_BIN,
        args: cliArgs,
        cwd: safeWorkspace,
        env,
      };
    }

    const image = provider === "codex" ? this.config.LEDGERLY_AI_CODEX_IMAGE : this.config.LEDGERLY_AI_CLAUDE_IMAGE;
    const sessionHome = path.resolve(this.sessions.home(provider));
    const containerSessionTarget = provider === "codex" ? "/home/ledgerly-ai/.codex" : "/home/ledgerly-ai";
    const containerArgs = [
      "run", "--rm",
      "--network", this.config.LEDGERLY_AI_DOCKER_NETWORK,
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--ipc=none",
      "--user", "1000:1000",
      "--pids-limit="+String(this.config.LEDGERLY_AI_WORKER_PIDS),
      "--memory="+String(this.config.LEDGERLY_AI_WORKER_MEMORY_MB)+"m",
      "--memory-swap="+String(this.config.LEDGERLY_AI_WORKER_MEMORY_MB)+"m",
      "--cpus="+String(this.config.LEDGERLY_AI_WORKER_CPUS),
      "--ulimit", "nofile="+String(this.config.LEDGERLY_AI_WORKER_NOFILE)+":"+String(this.config.LEDGERLY_AI_WORKER_NOFILE),
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size="+String(this.config.LEDGERLY_AI_WORKER_TMPFS_MB)+"m",
      "-e", "HOME=/home/ledgerly-ai",
      ...(provider === "codex" ? ["-e", "CODEX_HOME=/home/ledgerly-ai/.codex"] : []),
      "--mount", `type=bind,src=${safeWorkspace},dst=/workspace,rw`,
      "--mount", `type=bind,src=${sessionHome},dst=${containerSessionTarget},rw`,
      "-w", "/workspace",
      image,
      ...cliArgs,
    ];
    return { command: this.config.LEDGERLY_AI_DOCKER_BIN, args: containerArgs, cwd: safeWorkspace, env };
  }

  health(provider: LedgerlyAiProviderId): ProviderCommand {
    const cwd = this.config.LEDGERLY_AI_WORK_ROOT;
    if (this.config.LEDGERLY_AI_EXECUTION_MODE === "local") {
      return {
        command: provider === "codex" ? this.config.LEDGERLY_AI_CODEX_BIN : this.config.LEDGERLY_AI_CLAUDE_BIN,
        args: ["--version"],
        cwd,
        env: this.sessions.environment(provider),
      };
    }
    const image = provider === "codex" ? this.config.LEDGERLY_AI_CODEX_IMAGE : this.config.LEDGERLY_AI_CLAUDE_IMAGE;
    return {
      command: this.config.LEDGERLY_AI_DOCKER_BIN,
      args: ["run", "--rm", "--network", "none", image, "--version"],
      cwd,
      env: this.sessions.environment(provider),
    };
  }
}
