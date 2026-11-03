import type { Card, Expense } from './model';

export const categories = ['식비','생활','교육','교통','의료','여행','쇼핑','통신','보험','관리비','세금','상품권','기타'];
export function shiftMonth(month: string, offset: number) {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 1 + offset, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
export function parseThresholds(text: string): number[] {
  if (!text.trim()) return [];
  const values = text.split(/[,\n]/).map(v => Number(v.trim()));
  if (values.length > 5 || values.some(v => !Number.isSafeInteger(v) || v <= 0 || v > 1000000000)) {
    throw new Error('실적 구간은 원 단위 양수로 최대 5개까지 입력해 주세요. 예: 300000, 500000');
  }
  return [...new Set(values)].sort((a,b) => a-b);
}
export function qualifyingAmount(expense: Expense, card: Card) {
  if (expense.kind === 'income' || expense.kind === 'transfer') return 0;
  if (expense.qualifying_amount != null) return Number(expense.qualifying_amount);
  if (card.excluded_categories?.includes(expense.category)) return 0;
  return Number(expense.amount);
}
export function performanceMonth(expense: Expense) {
  return (expense.performance_month || expense.date).slice(0,7);
}
// If the family typed the card company's own figure for this month ("카드사 실적 보정"), start from it and add only records after that date.
export function cardProgress(card: Card, expenses: Expense[], month: string) {
  const override = card.perf_override_month?.slice(0, 7) === month && card.perf_override_amount != null ? { amount: Number(card.perf_override_amount), date: card.perf_override_date || `${month}-01` } : null;
  const records = expenses.filter(e => e.kind !== 'income' && e.kind !== 'transfer' && e.card_id === card.id && performanceMonth(e) === month && (!override || e.date > override.date));
  const amount = (override?.amount ?? 0) + records.reduce((sum,e) => sum + qualifyingAmount(e,card),0);
  const thresholds = [...new Set(card.performance_thresholds ?? [])].sort((a,b) => a-b);
  const achieved = thresholds.filter(t => amount >= t);
  const next = thresholds.find(t => amount < t) ?? null;
  const target = next ?? thresholds.at(-1) ?? 0;
  return {
    amount, records: records.length, thresholds, achieved, next, override,
    remaining: next == null ? 0 : next - amount,
    percent: target ? Math.max(0, Math.min(100, amount / target * 100)) : 0,
  };
}
export function validateQualifyingAmount(amount: number, qualifying: number | null) {
  if (qualifying == null) return;
  if (!Number.isSafeInteger(qualifying) || (amount > 0 ? qualifying < 0 || qualifying > amount : qualifying > 0 || qualifying < amount)) {
    throw new Error('인정 실적은 결제·환불 금액 범위 안에서 입력해 주세요. 환불 실적은 음수입니다.');
  }
}

// Category glyphs are plain emoji (no third-party icon sets); fixed costs are recurring rows or these categories.
export const categoryIcon: Record<string, string> = { '식비': '🍚', '생활': '🧺', '교육': '📚', '교통': '🚌', '의료': '💊', '여행': '✈️', '쇼핑': '🛍️', '통신': '📱', '보험': '🛡️', '관리비': '🏠', '세금': '🧾', '상품권': '🎫', '기타': '•', '자금 이동': '↔', '월급': '💰', '부수입': '💼', '용돈': '🎁', '환급': '↩️', '이자·배당': '🏦', '기타 수입': '＋' };
export const FIXED_CATEGORIES = ['관리비', '보험', '통신', '세금'];
export const isFixed = (e: { source?: string; category: string }) => e.source === 'recurring' || FIXED_CATEGORIES.includes(e.category);
export const normalizeKeyword = (title: string) => title.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);

// Repeated spending that is not registered as a recurring expense yet: same merchant, similar amount, in 2+ distinct months.
export function detectRecurringCandidates(expenses: { title: string; amount: number; date: string; kind?: string; source?: string }[], recurring: { title: string }[]) {
  const known = new Set(recurring.map(r => normalizeKeyword(r.title)));
  const groups = new Map<string, { title: string; amounts: number[]; months: Set<string>; last: string }>();
  for (const e of expenses) {
    if (e.kind === 'income' || e.kind === 'transfer' || e.source === 'recurring' || Number(e.amount) <= 0) continue;
    const k = normalizeKeyword(e.title); if (!k || known.has(k)) continue;
    const g = groups.get(k) ?? { title: e.title, amounts: [], months: new Set<string>(), last: e.date };
    g.amounts.push(Number(e.amount)); g.months.add(e.date.slice(0, 7)); if (e.date > g.last) g.last = e.date; groups.set(k, g);
  }
  return [...groups.values()].filter(g => g.months.size >= 2 && Math.max(...g.amounts) <= Math.min(...g.amounts) * 1.3)
    .map(g => ({ title: g.title, amount: Math.round(g.amounts.reduce((a, b) => a + b, 0) / g.amounts.length), months: g.months.size, day: Number(g.last.slice(8)) }))
    .sort((a, b) => b.months - a.months).slice(0, 5);
}
// A registered recurring expense whose latest matching charge came in noticeably higher.
export function detectIncreases(expenses: { title: string; amount: number; date: string; kind?: string }[], recurring: { id: string; title: string; amount: number }[]) {
  return recurring.flatMap(r => {
    const k = normalizeKeyword(r.title);
    const latest = expenses.filter(e => e.kind !== 'income' && e.kind !== 'transfer' && normalizeKeyword(e.title) === k && Number(e.amount) > 0).sort((a, b) => b.date.localeCompare(a.date))[0];
    return latest && Number(latest.amount) > r.amount * 1.1 ? [{ id: r.id, title: r.title, from: r.amount, to: Number(latest.amount), date: latest.date }] : [];
  });
}
// What to remember from a saved merchant: the brand word ("스타벅스" from "스타벅스 강남점"), or the whole name when it is a single word.
// Words that identify a bank, a channel or a sentence fragment rather than a merchant. Learning one of these as a rule
// (the 11/3 audit found 아이→기타, won뱅킹→기타, mg→기타, 1544-7000→기타) silently re-categorizes unrelated payments.
const RULE_STOPWORDS = /^(?:[a-z]{1,2}|mg|kb|nh|bc|won뱅킹|국민|신한|삼성|현대|롯데|우리|하나|농협|씨티|기업|토스|카카오|네이버|페이|pay|카드|체크|신용|은행|뱅킹|계좌이체|이체|출금|입금|승인|결제|간편|할인|주식회사|주|아이|님|고객|취소)$/i;
export function learnKeyword(title: string) {
  const cleaned = title.normalize('NFKC').replace(/\(주\)|㈜|주식회사|\(유\)/g, ' ').replace(/[()[\]·•|]/g, ' ').replace(/\s+/g, ' ').trim();
  // First meaningful token: branch suffixes (영등포문, 구로한) and numbers (1544-7000) never become the keyword.
  const key = cleaned.split(' ').find(t => t.length >= 2 && !/^[\d.,:/*-]+$/.test(t) && !RULE_STOPWORDS.test(t)) ?? '';
  return key.toLowerCase().slice(0, 60);
}
