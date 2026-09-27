import { describe, expect, it } from "vitest";
import { runProviderProcess } from "../src/features/ledgerly-ai/providers/process-runner.js";

describe("Ledgerly AI process runner", () => {
  it("keeps the provider's final result line after verbose output exceeds the capture budget", async () => {
    const script = `
      const noise = JSON.stringify({ type: "user", message: "x".repeat(2000) });
      for (let i = 0; i < 50; i++) console.log(noise);
      console.log(JSON.stringify({ type: "result", subtype: "success", result: "final answer" }));
    `;
    const result = await runProviderProcess({
      command: process.execPath,
      args: ["-e", script],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 20_000,
      maxOutputBytes: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.events.some((e) => e.type === "output.truncated")).toBe(true);
    const final = result.events.map((e) => e.data as { type?: string; result?: string }).find((d) => d?.type === "result");
    expect(final?.result).toBe("final answer");
  });
});
