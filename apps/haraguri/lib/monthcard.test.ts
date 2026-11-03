import { describe, expect, it } from 'vitest';
import { cardLines, chatDigests, monthCard, weekLine, won } from './monthcard';
import type { Budget, Expense, Member } from './model';

const members: Member[] = [{ user_id: 'dad', display_name: '아빠' }, { user_id: 'mom', display_name: '엄마' }];
const row = (id: string, date: string, title: string, amount: number, by = 'dad', extra: Partial<Expense> = {}): Expense => ({ id, family_id: 'f', card_id: null, title, amount, date, category: '기타', created_by: by, source: 'push', ...extra });
const expenses = [
  row('1', '2026-10-05', '롯데마트', 50000), row('2', '2026-10-20', '경일석유(주)덕', 30000),
  row('3', '2026-11-02', '롯데쇼핑(주)롯데마트', 13000), row('4', '2026-11-02', '우지커피 구로한', 8000, 'mom'),
  row('5', '2026-11-03', '삼성드림소아청소년과', 4900), row('6', '2026-11-03', '무지개약국', 2000, 'dad', { note: '지유 감기약' }),
  row('7', '2026-11-03', '아파트 관리비', 180000, 'mom', { category: '관리비', source: 'recurring' }),
  row('8', '2026-11-01', '급여', 3500000, 'dad', { kind: 'income' }), row('9', '2026-11-02', '토스 충전', 30000, 'dad', { kind: 'transfer' }),
];
const budgets: Budget[] = [{ family_id: 'f', month: '2026-11-01', total: 1000000, by_category: {} }];

describe('month card', () => {
  const c = monthCard(expenses, members, budgets, '2026-11', '2026-11-03', '지유');
  it('counts spending only, by person, with the budget remainder', () => {
    expect(c.total).toBe(13000 + 8000 + 4900 + 2000 + 180000);
    expect(c.byMember).toEqual([{ name: '엄마', amount: 188000 }, { name: '아빠', amount: 19900 }]);
    expect(c.budgetRemaining).toBe(1000000 - c.total);
    expect(c.closed).toBe(false);
  });
  it('finds first visits against earlier months and the child line from merchant words or the note', () => {
    // 롯데쇼핑(주)롯데마트 keys as 롯데쇼핑, which October's 롯데마트 never produced — so it counts as new; keyword matching is deliberately literal.
    expect(c.firstVisits.map(f => f.title)).toEqual(['아파트 관리비', '롯데쇼핑(주)롯데마트', '우지커피 구로한']);
    expect(c.child).toEqual({ label: '지유', amount: 6900, count: 2, places: ['삼성드림소아청소년과', '무지개약국'] });
    expect(c.fixed).toBe(180000); expect(c.variable).toBe(27900);
  });
  it('has no first visits in the very first month', () => {
    expect(monthCard(expenses, members, budgets, '2026-10', '2026-11-03').firstVisits).toEqual([]);
  });
  it('reads as sentences, not a table', () => {
    const lines = cardLines(c);
    expect(lines[0]).toMatch(/^11월 지금까지 20\.8만 썼어요 · 지난달보다 \d+% 더$/);
    expect(lines).toContain('엄마 18.8만 · 아빠 2만');
    expect(lines).toContain('지유에게 쓴 돈 · 6,900원 (2건 · 삼성드림소아청소년과·무지개약국)');
    expect(lines.some(l => l.startsWith('자주 간 곳 · '))).toBe(true);
    expect(lines.at(-1)).toBe('하루 6.9만이면 이번 달과 같아요');
  });
  it('formats money in 만 above ten thousand', () => {
    expect(won(1049001)).toBe('104.9만'); expect(won(500000)).toBe('50만'); expect(won(2000)).toBe('2,000원');
  });
});

describe('chat digests', () => {
  const now = new Date(2026, 10, 3, 12);
  const digests = chatDigests(expenses, members, budgets, '2026-11-03', '지유', now);
  it('posts the October card on November 1st at 09:00 and nothing for the current month yet', () => {
    const months = digests.filter(d => d.type === 'month');
    expect(months.map(d => d.id)).toEqual(['m-2026-10']);
    expect(new Date(months[0].time).getHours()).toBe(9);
  });
  it('posts a week line every Sunday evening that had spending, comparing with the week before', () => {
    const weeks = digests.filter(d => d.type === 'week');
    expect(weeks.at(-1)?.id).toBe('w-2026-10-26'); // Mon 10/26 – Sun 11/1, posted Sun 20:00; the week of 11/2 has not ended
    expect(weekLine({ id: 'w', time: '', type: 'week', weekStart: '2026-10-19', weekEnd: '2026-10-25', amount: 30000, previous: 50000, top: '경일석유(주)덕' })).toBe('이번 주 3만 · 지난주보다 40% 덜 · 제일 많이 경일석유(주)덕');
  });
  it('is empty without spending', () => { expect(chatDigests([], members, budgets, '2026-11-03')).toEqual([]); });
});
