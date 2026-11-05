import { describe as suite, expect, it } from 'vitest';
import { guessCategory, matchCard, parseCardMessage } from './cardsms';
import type { Card } from './model';

const now = new Date(2026, 9, 27, 12, 0, 0); // 2026-10-27
const card = (id: string, name: string, holder = ''): Card => ({ id, family_id: 'f', name, holder, budget: 0, credit_limit: 0 });

suite('weekend notification regressions', () => {
  it.each(['3원 적립', '2원 적립', '5원 적립', '105원을 토스뱅크 아이 통장에 쏙! 넣어드렸어요. (토스뱅크 알림)', '69,900원에서 10,640원으로 내렸어요'])('does not save a reward or price notice: %s', text => {
    expect(parseCardMessage(text, now)).toBeNull();
  });
  it('keeps a marked deposit as incoming even if the merchant contains 결제', () => {
    expect(parseCardMessage('[입금] 5,800원 9002-000-000*** 잔액 8,656원 11/02 04:45 간편결제할인', now)?.incoming).toBe(true);
  });
  it('preserves merchant names shared with payment providers and issuer names', () => {
    const mg = parseCardMessage('MG체크카드(1*6*) 29,000원 승인 10/27 19:10 네이버페이', now)!;
    const bank = parseCardMessage('[출금] 29,000원 9002-000-000*** 잔액 2,856원 10/27 19:10 네이버페이', now)!;
    expect(mg).toMatchObject({ issuer: '새마을', merchant: '네이버페이', channel: 'debit' });
    expect(fingerprintOf(mg)).toBe(fingerprintOf(bank));
    expect(parseCardMessage('[출금] 31,300원 9002-000-000*** 잔액 11,856원 10/27 17:57 현대아울렛 스페', now)?.merchant).toBe('현대아울렛 스페');
  });
  it('reads a FacePay payment when the amount is in the notification title', () => {
    expect(parseCardMessage('38,300원 결제\n페이스페이 (올바른POINT체크, 일시불) · 와플 베르비에', now)).toMatchObject({ amount: 38300, merchant: '와플 베르비에', category: '카페', channel: 'debit' });
  });
});

// Real formats from the 2026-11-03 ledger audit (REVIEW_LEDGER_2026-11-03.md): these were saved as 기타 or as false positives.
suite('ledger audit regressions (2026-11-03)', () => {
  it('reads the Shinhan approval merchant from 가맹점명 instead of the trailing phone number', () => {
    const p = parseCardMessage('[신한카드(2987)승인] 김*한 - 승인금액: 13,000원(일시불) - 승인일시: 11/02 15:13 - 가맹점명: 롯데쇼핑(주)롯데마트 [신한카드 1544-7000]', new Date(2026, 10, 3, 12))!;
    expect(p).toMatchObject({ amount: 13000, date: '2026-11-02', time: '15:13', merchant: '롯데쇼핑(주)롯데마트', issuer: '신한', last4: '2987', category: '식비' });
  });
  it.each([
    ['삼성드림소아청소년과', '의료'], ['아이파킹 주식회사', '교통'], ['바나프레소 영등포문', '카페'], ['무지개약국', '의료'], ['나이스 카페인 클럽 코오롱타워점', '카페'], ['지에스더프레시 양평', '기타'], ['다이소 양평점', '생활'],
  ])('categorizes the Shinhan merchant %s as %s', (merchant, category) => {
    expect(parseCardMessage(`[신한카드(2987)승인] 김*한 - 승인금액: 4,900원(일시불) - 승인일시: 11/03 11:00 - 가맹점명: ${merchant} [신한카드 1544-7000]`, now)).toMatchObject({ merchant, category, issuer: '신한' });
  });
  it('folds full-width letters so a WON bank withdrawal keeps its merchant', () => {
    expect(parseCardMessage('우리WON뱅킹 입출금알림 [출금] Ａｍａｚｏｎ＿Ａ 148원 1002-331-728***계좌 잔액 2,203,542원 11/02 10:14:10', now)).toMatchObject({ amount: 148, merchant: 'Amazon_A', category: '쇼핑', channel: 'bank_transfer', incoming: false });
  });
  it('keeps a pay-provider counterparty in WON bank and MG card pushes instead of a bank-word leftover', () => {
    expect(parseCardMessage('우리WON뱅킹 입출금알림 [출금] 카카오페이 44,000원 1002-331-728***계좌 잔액 2,016,950원 11/03 23:14:34', now)).toMatchObject({ amount: 44000, merchant: '카카오페이', channel: 'bank_transfer' });
    expect(parseCardMessage('MG새마을금고 MG체크카드(1*6*) 60,000원 승인 11/03 15:01 네이버페이', now)).toMatchObject({ amount: 60000, merchant: '네이버페이', issuer: '새마을', category: '쇼핑' });
  });
  it('treats a [입금] marker as incoming even after a 입출금알림 header', () => {
    expect(parseCardMessage('우리WON뱅킹 입출금알림 [입금] 체크할인캐시백 8원 1002-331-728***계좌 잔액 2,165,550원 11/03 11:18:22', now)?.incoming).toBe(true);
  });
  it('files a fuel station under 교통 whether it comes as an MG card or an MG bank push', () => {
    expect(parseCardMessage('MG새마을금고 [출금] 30,000원 9003-2867-****-8 잔액 8,656원 11/02 21:12 경일석유(주)덕', now)).toMatchObject({ amount: 30000, category: '교통' });
    expect(parseCardMessage('MG체크카드(1*6*) 29,000원 승인 10/31 12:10 경일석유(주)덕', now)).toMatchObject({ amount: 29000, merchant: '경일석유(주)덕', category: '교통', issuer: '새마을' });
  });
  it('never saves an advertisement, even one quoting a card and an amount', () => {
    const ad = '토스오더 (광고)[고미베이커 수원아이파크시티점] 고객 감사 할인 쿠폰 15,000원 이상 결제 시 휴대폰으로 11/10까지 씨티카드';
    expect(nonTransactionReason(ad)).toBe('광고 안내');
    expect(parseCardMessage(ad, now)).toBeNull();
    expect(nonTransactionReason('[광고] 현대카드 롯데백화점 혜택 안내')).toBe('광고 안내');
  });
  it('recognizes a top-up of the family\'s own pay wallet but not a payment to a merchant through it', () => {
    expect(selfTransferWallet('우리WON뱅킹 입출금알림 [출금] 토스 김기한 30,000원 1002-331-728***계좌 잔액 2,165,542원 11/02 21:11:23')).toBe('토스');
    expect(selfTransferWallet('우리WON뱅킹 입출금알림 [출금] 토스 수원아이 289,510원 1002-331-728***계좌 잔액 1,876,032원 10/30 09:00:00')).toBeNull();
    expect(selfTransferWallet('우리WON뱅킹 입출금알림 [출금] 우지커피 구로한 8,000원 1002-331-728***계좌 잔액 2,195,542원 11/02 10:33:51')).toBeNull();
  });
});

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
    expect(parseCardMessage('[삼성카드]김*한님 10/27 11:21 15,900원 일시불 승인 스타벅스 역삼점', now)).toMatchObject({ amount: 15900, merchant: '스타벅스 역삼점', issuer: '삼성', category: '카페' });
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
import { detectChannel, fingerprintOf, nonTransactionReason, selfTransferWallet } from './cardsms.core';

suite('reward promotion notifications', () => {
  it('uses the NH card header instead of the insurer name as the issuer', () => {
    const raw = '[Web발신]\nNH카드8*6*승인\r\n김*한\r\n25,580원 (일시불)\r\n10/28 17:06\r\n현대해상화재보험(주)';
    const parsed = parseCardMessage(raw, now)!;
    expect(parsed).toMatchObject({ amount: 25580, issuer: '농협', merchant: '현대해상화재보험(주)', category: '보험' });
    expect(matchCard(parsed, [card('nh', '농협카드'), card('hyundai', '현대카드')])).toBe('nh');
  });
  it.each([
    '오늘도 퀴즈 맞히고 최대 10원 받아가세요.',
    '이벤트 참여하고 1,000원 받으세요.',
    '출석 미션을 완료하면 최대 500원을 드려요.',
  ])('does not turn a reward offer into a payment: %s', raw => {
    expect(nonTransactionReason(raw)).toBe('이벤트·리워드 안내');
    expect(parseCardMessage(raw)).toBeNull();
  });
  it('keeps a real payment with a quiz promotion footer', () => {
    const raw = '신한카드(5678)승인 22,000원 일시불 10/30 11:21 동네마트\n퀴즈 맞히고 최대 10원 받아가세요.';
    expect(nonTransactionReason(raw)).toBeNull();
    expect(parseCardMessage(raw)?.amount).toBe(22000);
  });
  it('keeps a marked bank withdrawal with a reward footer', () => {
    const raw = '[출금] 커피앤메이트 1,700원\n1002-000-000***계좌 잔액 99,999원\n퀴즈 맞히고 최대 10원 받아가세요.';
    expect(nonTransactionReason(raw)).toBeNull();
    expect(parseCardMessage(raw)?.amount).toBe(1700);
  });
  it.each([
    '발견했어요. 친구가 떠나기 전에 눌러보세요.',
    '출석 티켓이 충전됐어요. (날씨 체크 알림)',
    '순금 복권 응모장 1장이 생겼어요\n오늘 응모하지 않으면 사라져요. (토스뱅크 알림)',
    '네이버페이 럭키볼 뽑기\n당첨 확률이 올라갔어요. 새로운 럭키볼 뽑으러 가기',
    '오늘 새로 열린 동전 미션 9개\n금요일 동전을 모아보세요. (토스뱅크 알림)',
  ])('classifies observed non-payment engagement notices: %s', raw => {
    expect(nonTransactionReason(raw)).toBe('이벤트·리워드 안내');
    expect(parseCardMessage(raw)).toBeNull();
  });
  it('recognizes decomposed Hangul in an observed point reward', () => {
    const raw = '포인트 도착 🎉\n1원 받았어요'.normalize('NFD');
    expect(nonTransactionReason(raw)).toBe('마일리지·포인트 혜택 안내');
    expect(parseCardMessage(raw)).toBeNull();
  });
  it('reads an actual payment with decomposed Hangul', () => {
    expect(parseCardMessage('신한카드 승인 12,000원 10/30 12:30 동네마트'.normalize('NFD'))).toMatchObject({ amount: 12000, issuer: '신한', merchant: '동네마트' });
  });
  it.each([
    '8원 받았어요'.normalize('NFD'),
    '클릭 한번에 응모하세요!🎵\n수신변경 : 전체메뉴>환경설정>푸시알림설정',
    '구름이 많고 흐린 날씨예요. (날씨 체크 알림)',
    '부가세 예정고지 납부 기한이 3일 남았어요. (토스인컴 알림)',
    '카드로 커피값도 아낄 수 있어요.',
  ])('skips later observed rewards and service notices: %s', raw => {
    expect(nonTransactionReason(raw)).not.toBeNull();
    expect(parseCardMessage(raw)).toBeNull();
  });
  it('keeps a payment when a small reward was also received', () => {
    const raw = '신한카드 승인 12,000원 10/30 12:30 동네마트\n8원 받았어요';
    expect(nonTransactionReason(raw)).toBeNull();
    expect(parseCardMessage(raw)?.amount).toBe(12000);
  });
});
suite('channel rules and the shared copy', () => {
  it('reads a WON bank withdrawal without confusing the masked account or balance with the merchant or amount', () => {
    const raw = '[출금] 커피앤메이트 1,700원\n1002-000-000***계좌 잔액\n99,999원 10/30 12:48:42';
    expect(parseCardMessage(raw, new Date('2026-10-30T13:00:00+09:00'))).toMatchObject({ amount: 1700, merchant: '커피앤메이트', channel: 'bank_transfer', category: '카페', date: '2026-10-30', time: '12:48' });
  });
  it('uses a bank fallback when a withdrawal contains only account metadata', () => {
    expect(parseCardMessage('[출금] 1,700원\n1002-000-000***계좌 잔액 99,999원', now)).toMatchObject({ amount: 1700, merchant: '계좌이체' });
  });
  it('preserves a merchant with a short numeric hyphen', () => {
    expect(parseCardMessage('[출금] 24-7카페 1,700원\n1002-000-000***계좌 잔액 99,999원', now)).toMatchObject({ amount: 1700, merchant: '24-7카페' });
  });
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

suite('benefit notices are not payments', () => {
  // Anonymized from a real false positive: the first amount is an accrual rate,
  // and "승인" refers to a corporate merger, not a card transaction.
  const mileageNotice = `[Web발신]
[신한카드] 아시아나항공 마일리지 적립 기준 변경 안내
안녕하세요, 고객님. 신한카드를 이용해 주셔서 감사합니다.
공정거래위원회의 대한항공-아시아나항공 기업결합 승인에 따라,
아시아나 마일리지 제도가 아래와 같이 변경될 예정입니다.
[변경 내용]
▶ 적용 대상 : 아시아나항공 제휴 신한카드 보유 고객
▶ 적용 일자 : 2026년 12월 17일 이용 건부터 적용
▶ 변경 사항 : 카드 이용 마일리지 적립 기준 변경
· 변경 사유 : 공정위 승인 마일리지 전환 비율(1:0.82) 반영
[적용 예시]
· 1,000원당 1.5마일 → 1,000원당 1.23 대한항공 마일리지
· 2,500원당 1.0마일 → 2,500원당 0.82 대한항공 마일리지
궁금하신 사항은 신한카드 고객센터로 문의해 주시기 바랍니다.`;

  it('rejects the Shinhan mileage policy notice that was saved as a 1,000-won expense', () => {
    expect(nonTransactionReason(mileageNotice)).toBe('마일리지·포인트 혜택 안내');
    expect(parseCardMessage(mileageNotice, now)).toBeNull();
  });

  it.each([
    '[신한카드] 마이신한포인트 적립 안내\n이번 달 포인트는 1,000원 상당입니다. 결제 시 사용할 수 있습니다.',
    '[현대카드] M포인트 소멸 예정 안내\n보유 포인트는 1,000원 상당입니다.',
    '[토스] 30,000원 이상 결제 시 1,000원 캐시백을 드려요. 이벤트에 참여해 보세요.',
    '[신한카드] 포인트 1,000원 적립되었습니다.',
    '[신한카드] 10/27까지 이벤트 참여 시 1,000원 결제 할인 혜택을 드립니다.',
    '[신한카드] 포인트 결제가 가능합니다. 1,000원부터 사용하세요.',
    '[신한카드] 1,000원 결제를 하면 포인트를 드려요.',
    '[신한카드] 적립 안내\n지난달 결제 완료 고객에게 1,000원 포인트 지급 예정',
  ])('rejects a reward notification without a completed payment: %s', text => {
    expect(parseCardMessage(text, now)).toBeNull();
    expect(nonTransactionReason(text)).toBe('마일리지·포인트 혜택 안내');
  });

  it('does not use a rate per won as a transaction amount, even outside a reward notice', () => {
    expect(parseCardMessage('적용 예시: 1,000원당 1회 제공', now)).toBeNull();
    expect(parseCardMessage('1,000 원 당 1회 제공', now)).toBeNull();
  });

  it('keeps real approvals with reward footnotes, regardless of message length', () => {
    const text = '[Web발신]\n신한카드(5678)승인\n김*한\n22,000원 일시불\n10/27 11:21\n동네마트\n마일리지 적립 기준 안내: 1,000원당 1마일\n' + '이용 상세 내역은 카드 앱에서 확인하실 수 있습니다.\n'.repeat(30);
    expect(nonTransactionReason(text)).toBeNull();
    expect(parseCardMessage(text, now)).toMatchObject({ amount: 22000, issuer: '신한', cancel: false });
  });

  it('finds the actual payment when a reward rate appears first', () => {
    const text = '마일리지 적립 기준: 1,000원당 1마일\n신한카드 승인 22,000원 10/27 11:21 동네마트';
    expect(parseCardMessage(text, now)).toMatchObject({ amount: 22000 });
  });

  it.each([
    ['토스 스타벅스에서 10,000원 결제되었어요.\n포인트 적립 안내: 100점', 10000],
    ['KB Pay 스타벅스 10,000원 결제\n포인트 적립 예정: 100점', 10000],
    ['카카오페이 결제 완료 10,000원 스타벅스\n포인트 적립 안내: 100점', 10000],
    ['신한카드 승인취소 22,000원 10/27 동네마트\n적립 포인트도 취소됩니다.', -22000],
    ['우리은행 10/27 11:30 출금 50,000원 월세 잔액 100,000원\n포인트 혜택 안내는 앱에서 확인하세요.', 50000],
  ])('keeps a completed payment with a reward mention: %s', (text, amount) => {
    expect(nonTransactionReason(text)).toBeNull();
    expect(parseCardMessage(text, now)).toMatchObject({ amount });
  });
});

// Card-app push notifications (iOS 27 Shortcuts "알림" trigger / Mac relay / Galaxy) arrive as title + body joined by the ingest function.
// The company name sits in the title and the body is a sentence, so these differ from SMS layouts.
suite('card-app push notification parsing', () => {
  it('reads KB Pay style: name, date, merchant, then amount with a sentence ending', () => {
    const p = parseCardMessage('KB국민카드 홍*동님 10/27 12:34 스타벅스 10,000원 승인되었습니다', now)!;
    expect(p).toMatchObject({ amount: 10000, date: '2026-10-27', time: '12:34', merchant: '스타벅스', issuer: '국민', cancel: false, category: '카페' });
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
