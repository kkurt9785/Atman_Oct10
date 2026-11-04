import type { Expense } from './model';
import { parseCardMessage } from './cardsms.core';

type PaymentRow = Pick<Expense, 'payment_method' | 'raw_text' | 'category' | 'source' | 'kind'>;

export function inferredPayment(row: PaymentRow) {
  return row.raw_text ? parseCardMessage(row.raw_text) : null;
}

export function paymentLabel(row: PaymentRow): string {
  if (row.kind === 'transfer') return row.category === '투자' ? '투자' : '본인 계좌 간 이동';
  if (row.payment_method === 'cash') return '현금';
  const parsed = inferredPayment(row);
  // No "카드 미등록" nag: the feed describes what happened; registering a card is an optional step under 카드.
  if (parsed?.channel === 'credit' || parsed?.channel === 'debit') {
    const type = parsed.channel === 'debit' ? '체크카드' : '신용카드';
    return `${parsed.issuer ? `${parsed.issuer} ` : ''}${type}`;
  }
  if (row.payment_method === 'bank_transfer') return '계좌이체';
  if (row.payment_method === 'card') return '카드';
  return '결제수단 미확인';
}

export function categoryLabel(row: PaymentRow): string {
  if (row.kind === 'transfer') return row.category === '투자' ? '투자' : '자금 이동';
  return row.category; // 기타 is just 기타 — never a "분류 미확인" chore
}

export function matchesPaymentFilter(row: PaymentRow, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'transfer') return row.kind === 'transfer';
  const parsed = inferredPayment(row);
  if (parsed?.channel === 'credit' || parsed?.channel === 'debit') return filter === parsed.channel;
  return filter === row.payment_method;
}
