import type { ProviderResult } from "./types.js";

const providerPatterns: RegExp[] = [
  /\bOpenAI\s+Codex\b/gi,
  /\bCodex\s+CLI\b/gi,
  /\bCodex\b/gi,
  /\bAnthropic\s+Claude\s+Code\b/gi,
  /\bClaude\s+Code\b/gi,
  /\bClaude\b/gi,
  /\bAnthropic\b/gi,
  /\bOpenAI\b/gi,
];

export function sanitizeLedgerlyAiPublicText(value: string) {
  return providerPatterns.reduce((text, pattern) => text.replace(pattern, "Ledgerly AI"), value);
}

export function toLedgerlyAiPublicResult(result: ProviderResult) {
  return {
    text: sanitizeLedgerlyAiPublicText(result.text),
    sessionId: result.sessionId,
    durationMs: result.durationMs,
  };
}
