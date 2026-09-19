import { toLedgerlyAiPublicResult } from "../providers/public-output.js";
import type { ProviderResult } from "../providers/types.js";

export function normalizeLedgerlyAiResponse(result: ProviderResult) {
  const publicResult = toLedgerlyAiPublicResult(result);
  return {
    content: publicResult.text.trim(),
    durationMs: publicResult.durationMs,
  };
}
