import { describe, expect, it } from 'vitest';
import { calcShiftMinutes, estimatedShiftPay, roundPay } from '../shared/gig-pay/shift-pay';
import { calcEstimatedShiftPay } from '../../../admin-web/lib/pay';

describe('shift pay — one formula for admin, worker and seeds', () => {
  it('deducts statutory breaks and rounds like the DB', () => {
    expect(estimatedShiftPay('23:00', '07:00', 14500)).toBe(108750); // 8h 구간 → 30분 휴게 → 7h30m (2026-11-05: 8:30 미만은 30분)
    expect(estimatedShiftPay('09:00', '13:00', 38000)).toBe(133000); // 4h → 30분 휴게 (10/22 QA P1 #3: 시드 152,000)
    expect(estimatedShiftPay('14:00', '18:00', 13500)).toBe(47250);
    expect(estimatedShiftPay('19:00', '23:00', 14500)).toBe(50750);
    expect(estimatedShiftPay('13:00', '18:00', 16000)).toBe(72000);
    expect(estimatedShiftPay('17:19', '18:04', 15000)).toBe(11250); // 45분, 휴게 없음
  });
  it('uses the statutory minimum break by span: <4:00 → 0, 4:00~8:29 → 30, 8:30+ → 60', () => {
    expect(calcShiftMinutes('09:00', '12:59')).toBe(239);
    expect(calcShiftMinutes('09:00', '13:00')).toBe(210);
    expect(calcShiftMinutes('07:00', '15:00')).toBe(450);
    expect(calcShiftMinutes('07:00', '15:29')).toBe(479);
    expect(calcShiftMinutes('07:00', '15:30')).toBe(450);
    expect(calcShiftMinutes('09:00', '18:00')).toBe(480);
  });
  it('matches the admin helper that applies the minimum-wage guard', () => {
    for (const [s, e, w] of [['23:00', '07:00', 14500], ['09:00', '13:00', 38000], ['19:00', '23:00', 14500]] as const) {
      expect(calcEstimatedShiftPay(s, e, w, '2026-10-22')).toBe(estimatedShiftPay(s, e, w));
    }
  });
  it('rounds (minutes × rate) / 60 so JS and the payout trigger agree at .5', () => {
    expect(roundPay(130, 12345)).toBe(26748); // 옛 식 Math.round((130/60)*12345) = 26747
    expect(roundPay(11, 9030)).toBe(1656);
    expect(roundPay(0, 15000)).toBe(0);
  });
  it('rejects malformed times and non-positive wages', () => {
    expect(calcShiftMinutes('9:00', '13:00')).toBeNull();
    expect(estimatedShiftPay('09:00', '13:00', 0)).toBeNull();
    expect(calcShiftMinutes('22:00', '22:00')).toBe(24 * 60 - 60);
  });
});
