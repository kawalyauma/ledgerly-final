const rules: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]"],
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]"],
  [/(["']?(?:password|passwd|secret|token|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[REDACTED]"],
  [/-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
];

export function redactLedgerlyAiText(value: string) {
  let text = value;
  for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement);
  return text;
}

export function redactLedgerlyAiValue(value: unknown): unknown {
  if (typeof value === "string") return redactLedgerlyAiText(value);
  if (Array.isArray(value)) return value.map(redactLedgerlyAiValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (/password|passwd|secret|token|api[_-]?key|authorization/i.test(key)) return [key, "[REDACTED]"];
      return [key, redactLedgerlyAiValue(item)];
    }));
  }
  return value;
}
