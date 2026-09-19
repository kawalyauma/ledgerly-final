import path from "node:path";
import type { LedgerlyAiConfig, LedgerlyAiProviderId } from "../config.js";
import type { LedgerlyAiSandbox } from "./types.js";
import { ProviderSessionStore } from "./session.js";

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
    if (this.config.LEDGERLY_AI_EXECUTION_MODE === "local") {
      if (sandbox === "workspace-write" && provider === "claude-code") {
        throw new Error("Claude Code workspace-write execution requires Docker isolation.");
      }
      return {
        command: provider === "codex" ? this.config.LEDGERLY_AI_CODEX_BIN : this.config.LEDGERLY_AI_CLAUDE_BIN,
        args: cliArgs,
        cwd: workspacePath,
        env,
      };
    }

    const image = provider === "codex" ? this.config.LEDGERLY_AI_CODEX_IMAGE : this.config.LEDGERLY_AI_CLAUDE_IMAGE;
    const sessionHome = path.resolve(this.sessions.home(provider));
    const containerSessionTarget = provider === "codex" ? "/home/ledgerly-ai/.codex" : "/home/ledgerly-ai";
    const containerArgs = [
      "run", "--rm",
      "--network", "bridge",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=512",
      "--memory=3g",
      "--cpus=2",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
      "-e", "HOME=/home/ledgerly-ai",
      ...(provider === "codex" ? ["-e", "CODEX_HOME=/home/ledgerly-ai/.codex"] : []),
      "-v", `${path.resolve(workspacePath)}:/workspace:rw`,
      "-v", `${sessionHome}:${containerSessionTarget}:rw`,
      "-w", "/workspace",
      image,
      ...cliArgs,
    ];
    return { command: this.config.LEDGERLY_AI_DOCKER_BIN, args: containerArgs, cwd: workspacePath, env };
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
