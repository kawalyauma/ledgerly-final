import path from "node:path";
import type { LedgerlyAiConfig, LedgerlyAiProviderId } from "../config.js";
import type { LedgerlyAiSandbox } from "./types.js";
import { ProviderSessionStore } from "./session.js";

function ensureInside(root:string,candidate:string,repositoryRoot:string|undefined,sandbox:LedgerlyAiSandbox){
  const resolvedRoot=path.resolve(root)+path.sep;
  const resolved=path.resolve(candidate);
  if(sandbox==="workspace-write"&&repositoryRoot&&resolved===path.resolve(repositoryRoot))return resolved;
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

  build(provider: LedgerlyAiProviderId, cliArgs: string[], workspacePath: string, sandbox: LedgerlyAiSandbox, runtimePaths?:{attachmentRoot?:string;outputRoot?:string}): ProviderCommand {
    const env = this.sessions.environment(provider);
    const safeWorkspace=ensureInside(this.config.LEDGERLY_AI_WORK_ROOT,workspacePath,this.config.LEDGERLY_AI_REPO_ROOT,sandbox);
    if (this.config.LEDGERLY_AI_EXECUTION_MODE === "local") {
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
    const isWorkspaceWrite = sandbox === "workspace-write";
    // Codex relies on this outer Docker boundary; nesting its bubblewrap sandbox
    // fails on loopback setup. Claude workspace-write still needs its own
    // namespace support.
    const needsNestedSandbox = provider === "claude-code" && isWorkspaceWrite;
    const containerName = `ledgerly-ai-${provider}-${path.basename(safeWorkspace)}-${Date.now()}`
      .replace(/[^a-zA-Z0-9_.-]/g,"-").slice(0,120);
    const repositoryWorkspace=Boolean(this.config.LEDGERLY_AI_REPO_ROOT)
      && safeWorkspace===path.resolve(this.config.LEDGERLY_AI_REPO_ROOT);
    const workspaceSource=repositoryWorkspace
      ? (this.config.LEDGERLY_AI_HOST_REPO_ROOT||this.config.LEDGERLY_AI_REPO_ROOT)
      : safeWorkspace;
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
      "--mount", `type=bind,src=${workspaceSource},dst=/workspace${isWorkspaceWrite ? "" : ",readonly"}`,
      "--mount", `type=bind,src=${sessionHome},dst=${containerSessionTarget}`,
      ...(runtimePaths?.attachmentRoot?["--mount",`type=bind,src=${path.resolve(runtimePaths.attachmentRoot)},dst=/attachments,readonly`]:[]),
      ...(runtimePaths?.outputRoot?["--mount",`type=bind,src=${path.resolve(runtimePaths.outputRoot)},dst=/outputs`]:[]),
      // A workspace under LEDGERLY_AI_WORK_ROOT is a `git worktree`, whose .git file points at
      // an admin dir inside the main repo's .git/worktrees/<id> by absolute path. Without the
      // main repo mounted at that same path, every git command inside the container fails with
      // "gitdir ... does not exist" — this is the container's only view of it, so it must land
      // at the identical absolute path the host/queue container uses.
      ...(!repositoryWorkspace?["--mount", `type=bind,src=${this.config.LEDGERLY_AI_HOST_REPO_ROOT},dst=${this.config.LEDGERLY_AI_REPO_ROOT},readonly`]:[]),
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
