import { describe as suite, expect, it } from 'vitest';
import { guessCategory, matchCard, parseCardMessage } from './cardsms';
import type { Card } from './model';

const now = new Date(2026, 9, 27, 12, 0, 0); // 2026-10-27
const card = (id: string, name: string, holder = ''): Card => ({ id, family_id: 'f', name, holder, budget: 0, credit_limit: 0 });

suite('card approval message parsing', () => {
  it('reads the KB multi-line format', () => {
    const p = parseCardMessage('[Web발신]\nKB국민카드 1234승인\n김*한\n48,300원 일시불\n10/27 11:21\n동네마트\n누적1,234,567원', now)!;
    expect(p).toMatchObject({ amount: 48300, date: '2026-10-27', time: '11:21', merchant: '동네마트', issuer: '국민', last4: '1234', cancel: false, installment: '일시불', category: '식비' });
  });
  it('reads a one-line Shinhan format with the running total removed', () => {
    const p = parseCardMessage('신한카드(5678)승인 김*한 220,000원(일시불)10/01 09:10 행복학원 누적2,000,000원', now)!;
    expect(p).toMatchObject({ amount: 220000, date: '2026-10-01', merchant: '행복학원', issuer: '신한', last4: '5678', category: '교육' });
  });
  it('reads Samsung and Hyundai orderings', () => {
    expect(parseCardMessage('[삼성카드]김*한님 10/27 11:21 15,900원 일시불 승인 스타벅스 역삼점', now)).toMatchObject({ amount: 15900, merchant: '스타벅스 역삼점', issuer: '삼성', category: '식비' });
    expect(parseCardMessage('현대카드 승인 김*한 64,000원 3개월 10/26 18:02 올리브영 강남', now)).toMatchObject({ amount: 64000, installment: '3개월', merchant: '올리브영 강남', category: '쇼핑', date: '2026-10-26' });
  });
  it('turns cancellations into refunds and keeps the merchant', () => {
    const p = parseCardMessage('[Web발신]\n롯데카드 승인취소\n김*한\n12,000원\n10/20 13:00\n약국', now)!;
    expect(p.cancel).toBe(true); expect(p.amount).toBe(-12000); expect(p.merchant).toBe('약국'); expect(p.category).toBe('의료');
  });
  it('assigns last year to a date later than today and defaults to today when no date is present', () => {
    expect(parseCardMessage('하나카드 승인 30,000원 12/24 19:30 치킨집', now)!.date).toBe('2025-12-24');
    expect(parseCardMessage('카카오페이 9,500원 결제 완료 카페온', now)!.date).toBe('2026-10-27');
    expect(parseCardMessage('농협카드 2026.09.30 승인 50,000원 주유소', now)).toMatchObject({ date: '2026-09-30', category: '교통', issuer: '농협' });
  });
  it('rejects text without an amount', () => {
    expect(parseCardMessage('오늘 저녁 뭐 먹을까요?', now)).toBeNull();
    expect(parseCardMessage('', now)).toBeNull();
  });
  it('matches the family card by last four digits, then issuer, then the only card', () => {
    const cards = [card('a', '국민 생활비', '끝 1234'), card('b', '신한 쇼핑', '5678')];
    const kb = parseCardMessage('KB국민카드 1234승인 1,000원 10/27 마트', now)!;
    expect(matchCard(kb, cards)).toBe('a');
    expect(matchCard(parseCardMessage('신한카드 승인 1,000원 10/27 마트', now)!, cards)).toBe('b');
    expect(matchCard(parseCardMessage('현대카드 승인 1,000원 10/27 마트', now)!, cards)).toBeNull();
    expect(matchCard(parseCardMessage('현대카드 승인 1,000원 10/27 마트', now)!, [cards[0]])).toBe('a');
  });
  it('guesses categories only from the allowed list', () => {
    expect(guessCategory('GS25 수원점')).toBe('식비');
    expect(guessCategory('알 수 없는 가맹점')).toBe('기타');
  });
});
