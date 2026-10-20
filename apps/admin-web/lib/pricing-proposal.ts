// Review-only estimate, never an invoice or access-control source.
// 검토안 v9.1 (2026-10-20): 공급가(부가세 별도). 15일 이상·50명 2주·50명 초과·복수 현장은 별도 견적.
export const TEMPORARY_PEOPLE = [10, 30, 50] as const;
export type TemporaryTier = (typeof TEMPORARY_PEOPLE)[number];
export const TEMPORARY_RATES: Record<TemporaryTier, { day: number; week: number; twoWeeks: number | null }> = {
  10: { day: 9900, week: 39000, twoWeeks: 69000 },
  30: { day: 19900, week: 79000, twoWeeks: 139000 },
  50: { day: 29900, week: 119000, twoWeeks: null },
};
export const TEMPORARY_MAX_DAYS = 14;

function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return timestamp;
}

/** 관리 인원 → 가격 구간. 50명 초과·0명·NaN은 null(별도 견적). */
export function temporaryTier(people: number): TemporaryTier | null {
  if (!Number.isFinite(people) || people < 1) return null;
  return TEMPORARY_PEOPLE.find(tier => people <= tier) ?? null;
}

/** 공급가. 1~7일: min(일수×1일가, 주 정액). 8~14일: min(주 정액 + 남은 일수×1일가, 2주 정액). 그 밖은 null. */
export function temporaryNet(tier: TemporaryTier, days: number): number | null {
  const rate = TEMPORARY_RATES[tier];
  if (!Number.isInteger(days) || days < 1 || days > TEMPORARY_MAX_DAYS) return null;
  if (days <= 7) return Math.min(days * rate.day, rate.week);
  if (rate.twoWeeks === null) return null;
  return Math.min(rate.week + (days - 7) * rate.day, rate.twoWeeks);
}

export function estimateTemporary(people: number, start: string, end: string) {
  const first = dateValue(start), last = dateValue(end);
  if (first === null || last === null || last < first) return null;
  const days = (last - first) / 86_400_000 + 1;
  const tier = temporaryTier(people);
  const net = tier === null ? null : temporaryNet(tier, days);
  if (net === null) return { days, tier, quote: null };
  const vat = Math.round(net * 0.1);
  return { days, tier, quote: { net, vat, total: net + vat } };
}
