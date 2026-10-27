import type { Expense, Member } from './model';
import { shiftMonth } from './finance';

// Monthly ledger report, computed on the client from the family's expenses.
export type Report = {
  month: string; total: number; previous: number; change: number | null; days: number; perDay: number;
  byCategory: { name: string; amount: number; share: number; previous: number }[];
  byMethod: { name: string; amount: number }[];
  byMember: { user_id: string; name: string; amount: number }[];
  topMerchants: { title: string; amount: number; count: number }[];
  refunds: number; count: number; pendingReview: number; income: number;
};
const methodLabel: Record<string, string> = { card: '카드', bank_transfer: '계좌이체', cash: '현금', other: '기타' };

export function monthlyReport(expenses: Expense[], members: Member[], month: string, today: string): Report {
  const rows = expenses.filter(e => e.date.startsWith(month) && e.kind !== 'income');
  const prevRows = expenses.filter(e => e.date.startsWith(shiftMonth(month, -1)) && e.kind !== 'income');
  const income = expenses.filter(e => e.date.startsWith(month) && e.kind === 'income').reduce((s, e) => s + Number(e.amount), 0);
  const sum = (list: Expense[]) => list.reduce((s, e) => s + Number(e.amount), 0);
  const total = sum(rows), previous = sum(prevRows);
  const group = <K extends string>(list: Expense[], key: (e: Expense) => K) => {
    const map = new Map<K, number>();
    for (const e of list) map.set(key(e), (map.get(key(e)) ?? 0) + Number(e.amount));
    return map;
  };
  const cats = group(rows, e => e.category), prevCats = group(prevRows, e => e.category);
  const byCategory = [...cats.entries()].map(([name, amount]) => ({ name, amount, share: total > 0 ? amount / total : 0, previous: prevCats.get(name) ?? 0 })).sort((a, b) => b.amount - a.amount);
  // Older rows without a method: a card id means a card payment.
  const byMethod = [...group(rows, e => e.payment_method ?? (e.card_id ? 'card' : 'other')).entries()].map(([k, amount]) => ({ name: methodLabel[k] ?? k, amount })).sort((a, b) => b.amount - a.amount);
  const byMember = [...group(rows, e => e.created_by).entries()].map(([user_id, amount]) => ({ user_id, name: members.find(m => m.user_id === user_id)?.display_name ?? '가족', amount })).sort((a, b) => b.amount - a.amount);
  const merchants = new Map<string, { amount: number; count: number }>();
  for (const e of rows) { if (Number(e.amount) <= 0) continue; const m = merchants.get(e.title) ?? { amount: 0, count: 0 }; m.amount += Number(e.amount); m.count++; merchants.set(e.title, m); }
  const topMerchants = [...merchants.entries()].map(([title, v]) => ({ title, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 5);
  // Per-day average uses elapsed days for the current month, full month otherwise.
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const days = today.startsWith(month) ? Number(today.slice(8)) : daysInMonth;
  return {
    month, total, previous, change: previous > 0 ? (total - previous) / previous : null, days, perDay: days ? Math.round(total / days) : 0,
    byCategory, byMethod, byMember, topMerchants,
    refunds: rows.filter(e => Number(e.amount) < 0).reduce((s, e) => s + Number(e.amount), 0), count: rows.length,
    pendingReview: expenses.filter(e => e.reviewed === false).length, income,
  };
}
