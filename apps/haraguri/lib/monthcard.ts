import type { Budget, Expense, Member } from './model';
import { budgetStatus } from './budget';
import { monthlyReport } from './report';
import { learnKeyword, shiftMonth } from './finance';

// "이번 달 우리 가족" — one card instead of a ledger report. Sentences over tables; people, places and days before categories
// (collected rows are reliable about who/where/how much, far less about category).
export type MonthCard = {
  month: string; total: number; previous: number; change: number | null; perDay: number; days: number; closed: boolean;
  budgetTotal: number; budgetRemaining: number;
  byMember: { name: string; amount: number }[];
  topMerchants: { title: string; count: number; amount: number }[];
  firstVisits: { title: string; amount: number }[];
  biggest: { title: string; amount: number; date: string } | null;
  refunds: number; fixed: number; variable: number; invest: number;
  child: { label: string; amount: number; count: number; places: string[] };
};
export type Digest =
  | { id: string; time: string; type: 'month'; card: MonthCard }
  | { id: string; time: string; type: 'week'; weekStart: string; weekEnd: string; amount: number; previous: number; top: string | null };

// Spending on the child: merchant words a family with a baby/toddler sees on card alerts. Categories alone can't tell 소아과 from 내과.
export const CHILD_KEYWORDS = /소아과|소아청소년과|소아|어린이|키즈|아기|아가|분유|기저귀|이유식|유아|어린이집|유치원|문화센터|예방접종|장난감|토이|베이비|육아|아동|돌잔치|산후/;

const spend = (e: Expense) => (e.kind ?? 'expense') === 'expense' && !e.canceled_by;
export const monthLabel = (month: string) => `${Number(month.slice(5))}월`;
export const won = (n: number) => Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(Math.abs(n) % 10000 ? 1 : 0).replace(/\.0$/, '')}만` : `${n.toLocaleString('ko-KR')}원`;

export function monthCard(expenses: Expense[], members: Member[], budgets: Budget[], month: string, today: string, childName = '아이'): MonthCard {
  const r = monthlyReport(expenses, members, month, today);
  const b = budgetStatus(budgets, expenses, month, today);
  const rows = expenses.filter(e => spend(e) && e.date.startsWith(month));
  const before = expenses.filter(e => spend(e) && e.date < `${month}-01`);
  const seen = new Set(before.map(e => learnKeyword(e.title)).filter(k => k.length >= 2));
  const first = new Map<string, { title: string; amount: number }>();
  if (before.length) for (const e of rows) { const k = learnKeyword(e.title); if (k.length >= 2 && !seen.has(k) && Number(e.amount) > 0) { const v = first.get(k) ?? { title: e.title, amount: 0 }; v.amount += Number(e.amount); first.set(k, v); } }
  const biggestRow = rows.filter(e => Number(e.amount) > 0).sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  // Merchant words, or the child's own name in the title/note ("지유 감기약") once the family has set it.
  const named = childName && childName !== '아이' ? childName : null;
  const isChild = (s: string) => CHILD_KEYWORDS.test(s) || (!!named && s.includes(named));
  const childRows = rows.filter(e => Number(e.amount) > 0 && (isChild(e.title) || isChild(e.note ?? '')));
  return {
    month, total: r.total, previous: r.previous, change: r.change, perDay: r.perDay, days: r.days, closed: month < today.slice(0, 7),
    budgetTotal: b.total, budgetRemaining: b.remaining,
    byMember: r.byMember.map(m => ({ name: m.name, amount: m.amount })),
    topMerchants: r.topMerchants.slice(0, 3),
    firstVisits: [...first.values()].sort((a, b) => b.amount - a.amount).slice(0, 3),
    biggest: biggestRow ? { title: biggestRow.title, amount: Number(biggestRow.amount), date: biggestRow.date } : null,
    refunds: r.refunds, fixed: r.fixed, variable: r.variable,
    invest: expenses.filter(e => e.kind === 'transfer' && e.category === '투자' && !e.canceled_by && e.date.startsWith(month)).reduce((s, e) => s + Number(e.amount), 0),
    child: { label: childName, amount: childRows.reduce((s, e) => s + Number(e.amount), 0), count: childRows.length, places: [...new Set(childRows.map(e => e.title))].slice(0, 3) },
  };
}

// The card as sentences — what the chat version shows and what a copy/paste carries.
export function cardLines(c: MonthCard): string[] {
  const lines: string[] = [];
  const pct = c.change === null ? null : Math.round(Math.abs(c.change) * 100);
  lines.push(`${monthLabel(c.month)}${c.closed ? '엔' : ' 지금까지'} ${won(c.total)} 썼어요${pct === null ? '' : pct === 0 ? ' · 지난달과 같아요' : c.change! > 0 ? ` · 지난달보다 ${pct}% 더` : ` · 지난달보다 ${pct}% 덜`}`);
  if (c.byMember.length > 1) lines.push(c.byMember.map(m => `${m.name} ${won(m.amount)}`).join(' · '));
  if (c.budgetTotal > 0) lines.push(c.budgetRemaining >= 0 ? `예산 ${won(c.budgetRemaining)} 남음` : `예산 ${won(-c.budgetRemaining)} 초과`);
  if (c.topMerchants.length) lines.push(`자주 간 곳 · ${c.topMerchants.map(m => `${m.title} ${m.count}번 ${won(m.amount)}`).join(' · ')}`);
  if (c.firstVisits.length) lines.push(`처음 간 곳 · ${c.firstVisits.map(m => `${m.title} ${won(m.amount)}`).join(' · ')}`);
  if (c.biggest) lines.push(`가장 큰 지출 · ${c.biggest.title} ${won(c.biggest.amount)} (${c.biggest.date.slice(5).replace('-', '/')})`);
  if (c.child.count) lines.push(`${c.child.label}에게 쓴 돈 · ${won(c.child.amount)} (${c.child.count}건${c.child.places.length ? ` · ${c.child.places.join('·')}` : ''})`);
  if (c.fixed > 0) lines.push(`고정비 ${won(c.fixed)} 빼면 생활비 ${won(c.variable)}`);
  if (c.refunds > 0) lines.push(`환불·취소 ${won(c.refunds)}`);
  if (c.invest > 0) lines.push(`투자로 ${won(c.invest)} 옮김 · 지출 합계엔 안 들어가요`);
  if (c.days > 0 && c.total > 0) lines.push(`하루 ${won(c.perDay)}이면 ${c.closed ? '지난달' : '이번 달'}과 같아요`);
  return lines;
}

const dateKey = (d: Date) => d.toLocaleDateString('sv-SE');
const localIso = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).toISOString();

// Virtual chat rows: the month card on the 1st at 09:00 for the month just ended, a one-line week summary on Sunday 20:00.
// Computed on each phone from the family's own data — nothing is written to the chat table.
export function chatDigests(expenses: Expense[], members: Member[], budgets: Budget[], today: string, childName = '아이', now = new Date()): Digest[] {
  const rows = expenses.filter(spend);
  if (!rows.length) return [];
  const earliest = rows.reduce((m, e) => e.date < m ? e.date : m, rows[0].date);
  const out: Digest[] = [];
  // Months
  for (let m = shiftMonth(earliest.slice(0, 7), 1); m <= today.slice(0, 7); m = shiftMonth(m, 1)) {
    const prev = shiftMonth(m, -1);
    if (!rows.some(e => e.date.startsWith(prev))) continue;
    const [y, mm] = m.split('-').map(Number);
    const time = localIso(y, mm, 1, 9);
    if (time > now.toISOString()) continue;
    out.push({ id: `m-${prev}`, time, type: 'month', card: monthCard(expenses, members, budgets, prev, today, childName) });
  }
  // Weeks (Mon–Sun), newest 26 at most
  const firstDay = new Date(`${earliest}T12:00:00`);
  const monday = new Date(firstDay); monday.setDate(firstDay.getDate() - ((firstDay.getDay() + 6) % 7));
  const weeks: Digest[] = [];
  for (let start = new Date(monday); ; start.setDate(start.getDate() + 7)) {
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const time = localIso(end.getFullYear(), end.getMonth() + 1, end.getDate(), 20);
    if (time > now.toISOString()) break;
    const ws = dateKey(start), we = dateKey(end);
    const prevStart = new Date(start); prevStart.setDate(start.getDate() - 7); const prevEnd = new Date(start); prevEnd.setDate(start.getDate() - 1);
    const inRange = (a: string, b: string) => rows.filter(e => e.date >= a && e.date <= b);
    const week = inRange(ws, we), amount = week.reduce((s, e) => s + Number(e.amount), 0), previous = inRange(dateKey(prevStart), dateKey(prevEnd)).reduce((s, e) => s + Number(e.amount), 0);
    if (amount <= 0 && previous <= 0) continue;
    const byPlace = new Map<string, number>(); for (const e of week) if (Number(e.amount) > 0) byPlace.set(e.title, (byPlace.get(e.title) ?? 0) + Number(e.amount));
    const top = [...byPlace.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    weeks.push({ id: `w-${ws}`, time, type: 'week', weekStart: ws, weekEnd: we, amount, previous, top });
  }
  return [...out, ...weeks.slice(-26)];
}

export function weekLine(d: Extract<Digest, { type: 'week' }>) {
  const diff = d.previous > 0 ? Math.round((d.amount - d.previous) / d.previous * 100) : null;
  return `이번 주 ${won(d.amount)}${diff === null ? '' : diff === 0 ? ' · 지난주와 같아요' : diff > 0 ? ` · 지난주보다 ${diff}% 더` : ` · 지난주보다 ${Math.abs(diff)}% 덜`}${d.top ? ` · 제일 많이 ${d.top}` : ''}`;
}
