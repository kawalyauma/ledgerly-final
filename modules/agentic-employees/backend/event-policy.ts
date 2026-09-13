export type EventSeverity = "info" | "attention" | "urgent";

export function attendanceSeverity(absenceCount: number, attentionCount: number, urgentCount: number): EventSeverity {
  if (absenceCount >= urgentCount) return "urgent";
  if (absenceCount >= attentionCount) return "attention";
  return "info";
}

export function booksStockSeverity(available: number, lowStockThreshold: number): EventSeverity | null {
  if (available > lowStockThreshold) return null;
  return available <= 0 ? "urgent" : "attention";
}

export function retryDelayMinutes(attempts: number) {
  return Math.max(1, attempts) * 5;
}
