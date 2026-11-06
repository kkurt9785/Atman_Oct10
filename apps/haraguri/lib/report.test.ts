import { describe, expect, it } from 'vitest';
import { monthlyReport } from './report';
import type { Expense } from './model';

const e = (id: string, amount: number, date: string, category: string, extra: Partial<Expense> = {}): Expense => ({ id, family_id: 'f', card_id: null, title: `t${id}`, amount, date, category, created_by: 'me', payment_method: 'card', ...extra });
const members = [{ user_id: 'me', display_name: '나' }, { user_id: 'you', display_name: '가족' }];

describe('monthly ledger report', () => {
  const expenses = [
    e('1', 100000, '2026-10-03', '식비'), e('2', 50000, '2026-10-10', '식비', { created_by: 'you', payment_method: 'cash' }), e('3', -20000, '2026-10-11', '식비'),
    e('4', 70000, '2026-10-20', '교통', { title: 'tX' }), e('5', 200000, '2026-09-05', '식비'), e('6', 30000, '2026-09-06', '쇼핑'),
    e('7', 9000, '2026-10-21', '기타', { reviewed: false, source: 'sms' }),
  ];
  const r = monthlyReport(expenses, members, '2026-10', '2026-10-27');
  it('totals the month net of refunds and compares with last month', () => {
    expect(r.total).toBe(209000); expect(r.previous).toBe(230000);
    expect(r.change).toBeCloseTo((209000 - 230000) / 230000, 5);
    expect(r.refunds).toBe(-20000); expect(r.count).toBe(5);
  });
  it('breaks down by category with share and last-month figure', () => {
    expect(r.byCategory[0]).toMatchObject({ name: '식비', amount: 130000, count: 3, previous: 200000 });
    expect(r.byCategory[0].share).toBeCloseTo(130000 / 209000, 5);
    expect(r.byCategory.find(c => c.name === '교통')).toMatchObject({ amount: 70000, previous: 0 });
  });
  it('splits by method and member, lists top merchants excluding refunds, and counts rows awaiting review', () => {
    expect(r.byMethod.map(m => m.name)).toEqual(['카드', '현금']);
    expect(r.byMember.map(m => m.name)).toEqual(['나', '가족']);
    expect(r.topMerchants[0]).toMatchObject({ title: 't1', amount: 100000, count: 1 });
    expect(r.topMerchants.some(m => m.title === 't3')).toBe(false);
    expect(r.pendingReview).toBe(1);
  });
  it('averages per elapsed day for the current month and per full month otherwise', () => {
    expect(r.days).toBe(27); expect(r.perDay).toBe(Math.round(209000 / 27));
    expect(monthlyReport(expenses, members, '2026-09', '2026-10-27').days).toBe(30);
    expect(monthlyReport([], members, '2026-08', '2026-10-27').change).toBeNull();
  });
});
