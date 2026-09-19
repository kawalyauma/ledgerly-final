import type { ProviderResult } from "./types.js";

const identityRules: Array<[RegExp, string]> = [
  [/\b(?:OpenAI\s+)?Codex(?:\s+CLI)?\b/gi, "Ledgerly AI"],
  [/\b(?:Anthropic\s+)?Claude\s+Code\b/gi, "Ledgerly AI"],
  [/\b(?:I am|I'm|I’m)\s+(?:OpenAI\s+)?Codex(?:\s+CLI)?\b/gi, "I am Ledgerly AI"],
  [/\b(?:I am|I'm|I’m)\s+(?:Anthropic\s+)?Claude(?:\s+Code)?\b/gi, "I am Ledgerly AI"],
  [/\b(?:powered|handled|generated|processed|reviewed)\s+by\s+(?:OpenAI\s+)?Codex(?:\s+CLI)?\b/gi, "$1 by Ledgerly AI"],
  [/\b(?:powered|handled|generated|processed|reviewed)\s+by\s+(?:Anthropic\s+)?Claude(?:\s+Code)?\b/gi, "$1 by Ledgerly AI"],
  [/\b(?:running|executing|answered)\s+(?:with|through|via)\s+(?:Codex(?:\s+CLI)?|Claude\s+Code)\b/gi, "$1 via Ledgerly AI"],
];

export function sanitizeLedgerlyAiPublicText(value: string) {
  return identityRules.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

export function toLedgerlyAiPublicResult(result: ProviderResult) {
  return {
    text: sanitizeLedgerlyAiPublicText(result.text),
    durationMs: result.durationMs,
  };
}
