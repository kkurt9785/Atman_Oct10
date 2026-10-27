import { describe, expect, it } from 'vitest';
import { parseOcrText, findDate } from './ocr';

const now = new Date('2026-10-27T12:00:00');

describe('screenshot OCR → transactions', () => {
  it('reads a card app list where each row has merchant, date/time and amount', () => {
    const text = `이용내역
스타벅스 역삼점                 4,500원
10.27 11:21 일시불
GS25 강남대로점                 3,200원
10.26 22:10 일시불
쿠팡                          48,300원
10.25 09:00 할부 3개월`;
    const rows = parseOcrText(text, now);
    expect(rows.map(r => [r.date, r.merchant, r.amount])).toEqual([
      ['2026-10-27', '스타벅스 역삼점', 4500], ['2026-10-26', 'GS25 강남대로점', 3200], ['2026-10-25', '쿠팡', 48300],
    ]);
  });
  it('uses a date header for the rows under it and marks cancellations negative', () => {
    const text = `2026.10.24 (금)
배달의민족 12,900원
승인취소 배달의민족 -12,900원
10월 23일
올리브영 명동점 23,000원`;
    const rows = parseOcrText(text, now);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-10-24', merchant: '배달의민족', amount: 12900, cancel: false });
    expect(rows[1]).toMatchObject({ date: '2026-10-24', amount: -12900, cancel: true });
    expect(rows[2]).toMatchObject({ date: '2026-10-23', merchant: '올리브영 명동점', amount: 23000 });
  });
  it('skips balance/summary lines and approval numbers, and fixes OCR digit slips', () => {
    const text = `이번 달 누적 1,234,567원
잔액 2,000,000원
10/22 14:21 이마트 트레이더스 l56,8OO원 승인번호 12345678
합계 156,800원`;
    const rows = parseOcrText(text, now);
    expect(rows).toEqual([expect.objectContaining({ date: '2026-10-22', merchant: '이마트 트레이더스', amount: 156800 })]);
  });
  it('infers last year for a month later than today and drops overlapping duplicates', () => {
    expect(findDate('12.05 커피', now)).toBe('2025-12-05');
    const text = `10.20 커피빈 5,000원
10.20 커피빈 5,000원`;
    expect(parseOcrText(text, now)).toHaveLength(1);
  });
});
