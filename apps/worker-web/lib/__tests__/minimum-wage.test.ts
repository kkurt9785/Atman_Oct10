import { describe, expect, it } from 'vitest';
import { hourlyWageError, minimumHourlyWage, staffPayPeriod, shiftHourlyWageError, wageTodayKST } from '../shared/gig-pay/minimum-wage';
import { calcEstimatedShiftPay } from '../../../admin-web/lib/pay';

describe('근무 연도별 최저시급', () => {
  it.each([['2026-12-31', 10320], ['2027-01-01', 10700]])('%s의 기준은 %i', (date, rate) => {
    expect(minimumHourlyWage(date)).toBe(rate);
    expect(hourlyWageError(rate, date)).toBeNull();
    expect(hourlyWageError(rate - 1, date)).toContain(rate.toLocaleString('ko-KR'));
  });
  it('다년 고정 시급에는 기간 중 가장 높은 기준을 적용한다', () => {
    expect(hourlyWageError(10320, '2026-12-20', '2027-01-10')).toContain('10,700');
    expect(hourlyWageError(10700, '2026-12-20', '2027-01-10')).toBeNull();
  });
  it.each(['', 'bad', '2026-02-30', '2026-2-01', '2028-01-01'])('잘못되거나 기준 미등록인 날짜는 통과하지 않는다: %s', date => {
    expect(minimumHourlyWage(date)).toBeNull();
    expect(hourlyWageError(999999, date)).not.toBeNull();
  });
  it('역전 기간·숫자 아닌 금액·소수 시급도 거부한다', () => {
    expect(minimumHourlyWage('2027-01-01', '2026-01-01')).toBeNull();
    for (const rate of [NaN, Infinity, -1, 10700.5]) expect(hourlyWageError(rate, '2027-01-01')).not.toBeNull();
  });
  it('UTC가 아닌 한국 자정에 연도를 바꾼다', () => {
    expect(wageTodayKST(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
  });
  it('기존 직원의 오래된 계약 시작일로 현재 기준을 우회하지 않는다', () => {
    expect(staffPayPeriod('2025-01-01', null, '2027-01-01')).toEqual({ start: '2027-01-01', end: '2027-01-01' });
  });
  it('연말 야간 근무는 퇴근일의 기준까지 검사한다', () => {
    expect(shiftHourlyWageError(10320, '2026-12-31', '22:00', '06:00')).toContain('10,700');
    expect(shiftHourlyWageError(10700, '2026-12-31', '22:00', '06:00')).toBeNull();
    expect(shiftHourlyWageError(10700, '2027-12-31', '22:00', '06:00')).not.toBeNull();
  });
  it('예상 지급액도 선택한 근무일로 검사한다', () => {
    expect(calcEstimatedShiftPay('09:00', '17:00', 10320, '2027-01-01')).toBeNull();
    expect(calcEstimatedShiftPay('09:00', '17:00', 10700, '2027-01-01')).toBe(74900);
  });
});
