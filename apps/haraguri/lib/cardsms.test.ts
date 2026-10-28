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

import { readFileSync } from 'node:fs';
import { detectChannel, fingerprintOf } from './cardsms.core';
suite('channel rules and the shared copy', () => {
  it('maps 계좌이체 / 잔액 / 누적 to bank, debit and credit', () => {
    expect(detectChannel('우리은행 출금 50,000원 잔액 1,234,567원 자동이체 관리비')).toBe('bank_transfer');
    expect(detectChannel('신한카드 승인 12,000원 잔액 300,000원 동네마트')).toBe('debit');
    expect(detectChannel('KB국민카드 승인 48,300원 누적 1,234,567원')).toBe('credit');
    expect(parseCardMessage('[Web발신] 우리은행 10/27 11:21 출금 350,000원 월세 잔액 1,200,000원', now)).toMatchObject({ channel: 'bank_transfer', amount: 350000, merchant: '월세' });
    expect(parseCardMessage('[Web발신] 우리은행 입금 1,000,000원 급여 잔액 2,000,000원', now)!.incoming).toBe(true);
  });
  it('prefers a card of the detected type when matching', () => {
    const cards = [card('credit', '국민 신용'), { ...card('debit', '국민 체크'), card_type: 'debit' as const }];
    expect(matchCard(parseCardMessage('KB국민카드 승인 1,000원 10/27 마트 누적 50,000원', now)!, cards)).toBe('credit');
    expect(matchCard(parseCardMessage('KB국민체크카드 승인 1,000원 10/27 마트 잔액 50,000원', now)!, cards)).toBe('debit');
  });
  it('fingerprints the same transaction identically regardless of whitespace', () => {
    const a = parseCardMessage('신한카드 승인 1,000원 10/27 11:21 동네 마트', now)!, b = parseCardMessage('신한카드  승인 1,000원  10/27 11:21 동네마트', now)!;
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });
  it('keeps the Deno copy of the parser identical to lib/cardsms.core.ts', () => {
    expect(readFileSync(new URL('../supabase/functions/_shared/cardsms.core.ts', import.meta.url), 'utf8')).toBe(readFileSync(new URL('./cardsms.core.ts', import.meta.url), 'utf8'));
  });
});

suite('Apple Pay transaction trigger text', () => {
  it('reads ₩ and KRW amounts without 원', () => {
    expect(parseCardMessage('거래 ₩12,000 GS25 수원점 현대카드', now)).toMatchObject({ amount: 12000, merchant: 'GS25 수원점', issuer: '현대', category: '식비' });
    expect(parseCardMessage('KRW 48,300 스타벅스 역삼점 10/26 09:10', now)).toMatchObject({ amount: 48300, merchant: '스타벅스 역삼점', date: '2026-10-26' });
  });
});

// Card-app push notifications (iOS 27 Shortcuts "알림" trigger / Mac relay / Galaxy) arrive as title + body joined by the ingest function.
// The company name sits in the title and the body is a sentence, so these differ from SMS layouts.
suite('card-app push notification parsing', () => {
  it('reads KB Pay style: name, date, merchant, then amount with a sentence ending', () => {
    const p = parseCardMessage('KB국민카드 홍*동님 10/27 12:34 스타벅스 10,000원 승인되었습니다', now)!;
    expect(p).toMatchObject({ amount: 10000, date: '2026-10-27', time: '12:34', merchant: '스타벅스', issuer: '국민', cancel: false, category: '식비' });
  });
  it('reads Shinhan SOL style with installment and a two-word merchant', () => {
    const p = parseCardMessage('신한카드 승인 홍*동 4,500원 일시불 10/27 08:15 스타벅스 역삼점', now)!;
    expect(p).toMatchObject({ amount: 4500, merchant: '스타벅스 역삼점', issuer: '신한', installment: '일시불' });
  });
  it('reads Toss / KakaoPay / NaverPay sentences ("…에서 N원 결제되었어요")', () => {
    expect(parseCardMessage('토스 스타벅스에서 10,000원 결제되었어요', now)).toMatchObject({ amount: 10000, merchant: '스타벅스', issuer: '토스', channel: 'unknown' });
    expect(parseCardMessage('카카오페이 결제 완료 스타벅스 10,000원 결제', now)).toMatchObject({ merchant: '스타벅스', issuer: '카카오페이' });
    expect(parseCardMessage('네이버페이 결제완료 10,000원 스타벅스 결제가 완료되었습니다', now)).toMatchObject({ merchant: '스타벅스', issuer: '네이버페이' });
  });
  it('reads Hyundai / Samsung / Lotte orderings', () => {
    expect(parseCardMessage('현대카드 승인 12,000원 (일시불) 올리브영 10/27 19:02', now)).toMatchObject({ amount: 12000, merchant: '올리브영', issuer: '현대', category: '쇼핑', time: '19:02' });
    expect(parseCardMessage('삼성카드 홍*동님 10/27 13:10 7,900원 승인 GS25 서초점', now)).toMatchObject({ amount: 7900, merchant: 'GS25 서초점', issuer: '삼성', category: '식비' });
    expect(parseCardMessage('[롯데카드] 승인 홍*동 25,000원 10/27 18:40 쿠팡', now)).toMatchObject({ amount: 25000, merchant: '쿠팡', issuer: '롯데', category: '쇼핑' });
  });
  it('drops the app name even when it leads the merchant (KB Pay, SOL페이)', () => {
    expect(parseCardMessage('KB Pay 스타벅스 10,000원 결제', now)).toMatchObject({ merchant: '스타벅스', issuer: '국민' });
    expect(parseCardMessage('SOL페이 승인 3,000원 메가커피', now)).toMatchObject({ merchant: '메가커피', issuer: '신한' });
  });
  it('treats a push cancellation as a refund', () => {
    expect(parseCardMessage('KB국민카드 승인취소 10,000원 10/27 12:40 스타벅스', now)).toMatchObject({ amount: -10000, cancel: true, merchant: '스타벅스' });
  });
  it('fingerprints the same purchase identically whether it came as SMS or as an app push', () => {
    const sms = parseCardMessage('[Web발신]\nKB국민카드 1234승인\n김*한\n10,000원 일시불\n10/27 12:34\n스타벅스\n누적1,234,567원', now)!;
    const push = parseCardMessage('KB국민카드 홍*동님 10/27 12:34 스타벅스 10,000원 승인되었습니다', now)!;
    expect(fingerprintOf(sms)).toBe(fingerprintOf(push));
  });
});
