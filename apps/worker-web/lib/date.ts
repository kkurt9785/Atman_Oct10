const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function dateKST(offsetDays = 0, date = new Date()): string {
  return new Date(date.getTime() + KST_OFFSET_MS + offsetDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function monthKST(date = new Date()): string {
  return dateKST(0, date).slice(0, 7);
}
