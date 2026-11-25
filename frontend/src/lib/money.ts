const RM_PREFIX = /^rm\s*/i;
const PLAIN = /^\d+(\.\d+)?$/;
const GROUPED = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

export const MIN_AMOUNT = 10; // minimum asking price and budget in RM

export function parseMoney(input: string): number | null {
  const trimmed = input.trim();
  const stripped = trimmed.replace(RM_PREFIX, "");
  if (!PLAIN.test(stripped) && !GROUPED.test(stripped)) return null;
  const value = Number(stripped.replace(/,/g, ""));
  return value > 0 ? value : null;
}

export function isAmountValid(value: number | null): value is number {
  return value !== null && value >= MIN_AMOUNT;
}
