export type LedgerDimensionValue = string | number | boolean | null;

/** Keep only dimensions whose non-null value is identical on every source line. */
export function sharedLedgerDimensions(rows: Array<Record<string, LedgerDimensionValue> | null | undefined>) {
  const first = rows[0] ?? {};
  return Object.fromEntries(Object.entries(first).filter(([key, value]) =>
    value !== null && value !== undefined && rows.every(row => row?.[key] === value),
  ));
}
