import { describe, expect, it } from 'vitest';
import { suggestCards } from './cardsuggest';
import type { Card, Expense } from './model';

const shinhan = (id: string, merchant: string): Expense => ({ id, family_id: 'f', card_id: null, title: merchant, amount: 4900, date: '2026-11-03', category: '기타', created_by: 'me', source: 'push', reviewed: false, raw_text: `[신한카드(2987)승인] 김*한 - 승인금액: 4,900원(일시불) - 승인일시: 11/03 11:00 - 가맹점명: ${merchant} [신한카드 1544-7000]` });
const mg: Expense = { id: 'm1', family_id: 'f', card_id: null, title: '경일석유(주)덕', amount: 29000, date: '2026-10-31', category: '교통', created_by: 'me', source: 'push', reviewed: true, raw_text: 'MG체크카드(1*6*) 29,000원 승인 10/31 12:10 경일석유(주)덕' };
const bank: Expense = { id: 'b1', family_id: 'f', card_id: null, title: '우지커피 구로한', amount: 8000, date: '2026-11-02', category: '식비', created_by: 'me', source: 'push', reviewed: true, raw_text: '우리WON뱅킹 입출금알림 [출금] 우지커피 구로한 8,000원 1002-331-728***계좌 잔액 2,195,542원 11/02 10:33:51' };
const card = (id: string, name: string): Card => ({ id, family_id: 'f', name, holder: '아빠', budget: 0, credit_limit: 0 });

describe('card registration suggestions from collected payments', () => {
  it('groups unregistered cards by issuer and digits, most payments first, and skips bank transfers', () => {
    const s = suggestCards([shinhan('s1', '무지개약국'), shinhan('s2', '바나프레소 영등포문'), mg, bank], []);
    expect(s.map(x => [x.name, x.card_type, x.expenseIds])).toEqual([['신한카드(2987)', 'credit', ['s1', 's2']], ['새마을 체크카드', 'debit', ['m1']]]);
  });
  it('stops suggesting a card once one is registered with those digits or that issuer', () => {
    expect(suggestCards([shinhan('s1', '무지개약국'), mg], [card('c1', '신한카드(2987)')]).map(x => x.name)).toEqual(['새마을 체크카드']);
    expect(suggestCards([shinhan('s1', '무지개약국'), mg], [card('c1', '신한 생활비'), card('c2', '새마을 체크')])).toEqual([]);
  });
  it('never treats the family\'s only card as a match for a different issuer', () => {
    expect(suggestCards([mg], [card('c1', '신한카드(2987)')]).map(x => x.name)).toEqual(['새마을 체크카드']);
  });
  it('ignores rows that already have a card, were canceled, or are not expenses', () => {
    expect(suggestCards([{ ...shinhan('s1', '무지개약국'), card_id: 'c1' }, { ...shinhan('s2', '약국'), canceled_by: 'x' }, { ...shinhan('s3', '약국'), kind: 'transfer' }], [])).toEqual([]);
  });
});
