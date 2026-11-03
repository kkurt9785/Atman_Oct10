import { describe, expect, it } from 'vitest';
import { sameMerchantTargets, suggestCategories, unclassifiedExpenses } from './classify';
import type { CategoryRule, Expense } from './model';

const row = (id: string, title: string, extra: Partial<Expense> = {}): Expense => ({ id, family_id: 'f', card_id: null, title, amount: 1000, date: '2026-11-03', category: '기타', created_by: 'me', source: 'push', reviewed: false, ...extra });
const rule = (keyword: string, category: string): CategoryRule => ({ id: keyword, family_id: 'f', keyword, category });

describe('one-tap classification', () => {
  it('ranks the current category, then a family rule, then how the merchant was filed before, then merchant words', () => {
    const all = [row('a', '우지커피 구로한'), row('b', '우지커피 구로한', { category: '식비', reviewed: true }), row('c', '행복학원', { category: '교육', reviewed: true })];
    expect(suggestCategories(row('x', '우지커피 양평'), all, [])).toEqual(['식비', '교육', '생활']);
    expect(suggestCategories(row('x', '무지개약국', { category: '의료' }), all, [rule('무지개', '생활')])).toEqual(['의료', '생활', '식비']);
    expect(suggestCategories(row('x', '1544-7000'), [], [])).toEqual(['식비', '생활', '쇼핑']);
  });
  it('never offers 기타 as a chip and never repeats a category', () => {
    const chips = suggestCategories(row('x', '경일석유(주)덕'), [row('y', '경일석유(주)덕', { category: '교통', reviewed: true })], []);
    expect(chips).toEqual(['교통', '식비', '생활']);
    expect(new Set(chips).size).toBe(3);
  });
  it('lists reviewed auto rows still in 기타 as unclassified, but not manual, canceled or open rows', () => {
    const all = [row('a', '사격팡', { reviewed: true }), row('b', '수동 입력', { reviewed: true, source: 'manual' }), row('c', '취소된 것', { reviewed: true, canceled_by: 'z' }), row('d', '아직 확인 전')];
    expect(unclassifiedExpenses(all).map(x => x.id)).toEqual(['a']);
  });
  it('groups open and still-기타 rows from the same merchant, ignoring settled ones and phone-number titles', () => {
    const all = [row('a', '롯데쇼핑(주)롯데마트'), row('b', '롯데쇼핑(주)롯데마트 영등포', { reviewed: true }), row('c', '롯데쇼핑 마트', { reviewed: true, category: '식비' }), row('d', '1544-7000'), row('e', '1544-7000')];
    expect(sameMerchantTargets(all[0], all).map(x => x.id)).toEqual(['b']);
    expect(sameMerchantTargets(all[3], all)).toEqual([]);
  });
});
