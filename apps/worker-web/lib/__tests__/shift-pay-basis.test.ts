import { describe, expect, it } from 'vitest';
import { payBasisLabel } from '../shift-pay-basis';
import { estimatedShiftPay } from '../shared/gig-pay/shift-pay';

const shift = (start_time: string, end_time: string, hourly_wage = 12000, estimated_total_pay = estimatedShiftPay(start_time, end_time, hourly_wage) ?? 0) => ({ start_time, end_time, hourly_wage, estimated_total_pay });

describe('payBasisLabel — 지원 시트 예상 지급액 아래 휴게 설명', () => {
  it('8:00 구간은 휴게 30분(7시간 30분), 8:30 이상부터 60분 — 화면 문구는 calcBreakMinutes 를 따라간다', () => {
    expect(payBasisLabel(shift('07:00:00', '15:00:00'))).toBe('휴게 30분을 빼고 7시간 30분 기준이에요');
    expect(payBasisLabel(shift('09:00', '17:29'))).toBe('휴게 30분을 빼고 7시간 59분 기준이에요');
    expect(payBasisLabel(shift('09:00', '17:30'))).toBe('휴게 60분을 빼고 7시간 30분 기준이에요');
    expect(payBasisLabel(shift('09:00', '18:00'))).toBe('휴게 60분을 빼고 8시간 기준이에요');
  });
  it('4시간 이상은 30분, 자정을 넘는 근무도 같은 식', () => {
    expect(payBasisLabel(shift('09:00', '13:00'))).toBe('휴게 30분을 빼고 3시간 30분 기준이에요');
    expect(payBasisLabel(shift('22:00', '07:00'))).toBe('휴게 60분을 빼고 8시간 기준이에요');
  });
  it('4시간 미만은 휴게 없이', () => {
    expect(payBasisLabel(shift('09:00', '12:59'))).toBe('휴게 없이 3시간 59분 기준이에요');
    expect(payBasisLabel(shift('09:00', '09:45'))).toBe('휴게 없이 45분 기준이에요');
  });
  it('공유 식과 다른 금액(시드 등)에는 설명을 붙이지 않는다', () => {
    expect(payBasisLabel(shift('09:00', '13:00', 38000, 152000))).toBeNull();
    expect(payBasisLabel(shift('9시', '13:00', 38000, 133000))).toBeNull();
  });
});
