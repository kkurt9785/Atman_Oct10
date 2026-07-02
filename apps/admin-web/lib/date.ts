const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function todayKST(date = new Date()): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function yesterdayKST(date = new Date()): string {
  return new Date(date.getTime() + KST_OFFSET_MS - DAY_MS).toISOString().slice(0, 10);
}
