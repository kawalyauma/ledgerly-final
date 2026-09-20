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
    // workspace-write (engineering-incident) jobs run the CLI's own bubblewrap
    // sandbox, which needs to create a nested mount/user namespace. Docker's
    // default seccomp/AppArmor profile and a stripped capability set block
    // that namespace creation outright, so those jobs get a narrower,
    // deliberately relaxed profile instead of the standard hardened one.
    // read-only (chat/named-employee) jobs never take this branch.
    const isWorkspaceWrite = sandbox === "workspace-write";
    // Codex enforces both read-only and workspace-write modes with its own
    // Linux sandbox. That sandbox needs a nested mount/user namespace even
    // when it is only reading files (for example an uploaded OCR image).
    // Keep the host bind explicitly read-only for read-only requests while
    // allowing the namespace setup inside this already-isolated container.
    const needsNestedSandbox = provider === "codex" || isWorkspaceWrite;
    const containerName = `ledgerly-ai-${provider}-${path.basename(safeWorkspace)}-${Date.now()}`
      .replace(/[^a-zA-Z0-9_.-]/g,"-").slice(0,120);
    const containerArgs = [
      "run", "--rm",
      "--name", containerName,
      "--network", this.config.LEDGERLY_AI_DOCKER_NETWORK,
      "--read-only",
      ...(needsNestedSandbox
        ? ["--cap-drop=ALL", "--cap-add=SYS_ADMIN", "--security-opt=seccomp=unconfined", "--security-opt=apparmor=unconfined"]
        : ["--cap-drop=ALL", "--security-opt=no-new-privileges"]),
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
      "--mount", `type=bind,src=${safeWorkspace},dst=/workspace${isWorkspaceWrite ? "" : ",readonly"}`,
      "--mount", `type=bind,src=${sessionHome},dst=${containerSessionTarget}`,
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
