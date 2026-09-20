import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ProviderStreamEvent } from "./types.js";
import { redactLedgerlyAiText } from "../gateway/redaction.js";

export type ProcessRunOptions = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  onEvent?: (event: ProviderStreamEvent) => void | Promise<void>;
};

export type ProcessRunResult = {
  exitCode: number;
  durationMs: number;
  stdoutLines: string[];
  stderrLines: string[];
  events: ProviderStreamEvent[];
  timedOut: boolean;
  aborted: boolean;
};

function parseLine(stream: "stdout" | "stderr", line: string): ProviderStreamEvent {
  let data: unknown = line;
  let type = stream === "stdout" ? "output" : "diagnostic";
  try {
    data = JSON.parse(line);
    if (data && typeof data === "object" && "type" in data && typeof (data as { type?: unknown }).type === "string") {
      type = (data as { type: string }).type;
    }
  } catch {
    // Plain text output is valid.
  }
  return { at: new Date().toISOString(), stream, type, data, raw: line };
}

export function runProviderProcess(options: ProcessRunOptions): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const events: ProviderStreamEvent[] = [];
    let capturedBytes = 0;
    let truncationEmitted = false;
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let eventDelivery:Promise<void>=Promise.resolve();
    const nameIndex=options.args.indexOf("--name");
    const dockerContainerName=nameIndex>=0&&typeof options.args[nameIndex+1]==="string"?options.args[nameIndex+1]:null;

    const emit = (event: ProviderStreamEvent) => {
      events.push(event);
      if(options.onEvent){
        eventDelivery=eventDelivery
          .then(async()=>{await options.onEvent?.(event);})
          .catch(()=>{});
      }
    };

    const capture = (stream: "stdout" | "stderr", line: string) => {
      const safeLine=redactLedgerlyAiText(line);
      const bytes = Buffer.byteLength(safeLine, "utf8");
      if (capturedBytes + bytes > options.maxOutputBytes) {
        if (!truncationEmitted) {
          truncationEmitted = true;
          emit({ at: new Date().toISOString(), stream: "system", type: "output.truncated", data: { maxOutputBytes: options.maxOutputBytes } });
        }
        return;
      }
      capturedBytes += bytes;
      (stream === "stdout" ? stdoutLines : stderrLines).push(safeLine);
      emit(parseLine(stream, safeLine));
    };

    const stdout = createInterface({ input: child.stdout });
    const stderr = createInterface({ input: child.stderr });
    stdout.on("line", (line) => capture("stdout", line));
    stderr.on("line", (line) => capture("stderr", line));

    const terminate = (reason: "timeout" | "abort") => {
      if (child.exitCode !== null || child.killed) return;
      timedOut = reason === "timeout";
      aborted = reason === "abort";
      child.kill("SIGTERM");
      if(dockerContainerName){
        const cleanup=spawn(options.command,["rm","-f",dockerContainerName],{
          cwd:options.cwd,env:options.env,stdio:"ignore",shell:false,windowsHide:true,
        });
        cleanup.unref();
      }
      setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 5_000).unref();
    };

    const timeout = setTimeout(() => terminate("timeout"), options.timeoutMs);
    timeout.unref();
    const abort = () => terminate("abort");
    options.signal?.addEventListener("abort", abort, { once: true });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      stdout.close();
      stderr.close();
      reject(error);
    });

    child.once("close", async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      stdout.close();
      stderr.close();
      await eventDelivery;
      resolve({
        exitCode: code ?? 1,
        durationMs: Date.now() - started,
        stdoutLines,
        stderrLines,
        events,
        timedOut,
        aborted,
      });
    });
  });
}
