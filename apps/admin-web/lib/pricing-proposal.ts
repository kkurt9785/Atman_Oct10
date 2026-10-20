// Review-only estimate, never an invoice or access-control source.
export const TEMPORARY_PEOPLE = [10, 30, 50] as const;
function dateValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return timestamp;
}
export function estimateTemporary(people: number, start: string, end: string) {
  const first = dateValue(start), last = dateValue(end);
  if (first === null || last === null || last < first) return null;
  const days = (last - first) / 86_400_000 + 1;
  if (people !== 10 || days > 7) return { days, quote: null };
  const net = Math.min(days * 9900, 39000);
  const vat = Math.round(net * 0.1);
  return { days, quote: { net, vat, total: net + vat } };
}
