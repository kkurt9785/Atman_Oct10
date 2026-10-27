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
  if (expense.qualifying_amount != null) return Number(expense.qualifying_amount);
  if (card.excluded_categories?.includes(expense.category)) return 0;
  return Number(expense.amount);
}
export function performanceMonth(expense: Expense) {
  return (expense.performance_month || expense.date).slice(0,7);
}
export function cardProgress(card: Card, expenses: Expense[], month: string) {
  const records = expenses.filter(e => e.card_id === card.id && performanceMonth(e) === month);
  const amount = records.reduce((sum,e) => sum + qualifyingAmount(e,card),0);
  const thresholds = [...new Set(card.performance_thresholds ?? [])].sort((a,b) => a-b);
  const achieved = thresholds.filter(t => amount >= t);
  const next = thresholds.find(t => amount < t) ?? null;
  const target = next ?? thresholds.at(-1) ?? 0;
  return {
    amount, records: records.length, thresholds, achieved, next,
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
