import { describe, expect, it } from 'vitest';
import { payReviewFlags, scheduledSpanMinutes } from '../../../admin-web/lib/gig-pay-review';

describe('지급 전 확인할 근무', () => {
  it('예정 근무 분을 센다(자정 넘김 포함)', () => {
    expect(scheduledSpanMinutes('14:16:00', '15:01:00')).toBe(45);
    expect(scheduledSpanMinutes('22:00', '06:00')).toBe(480);
    expect(scheduledSpanMinutes(null, '06:00')).toBeNull();
  });
  it('예정 45분에 42분 일한 근무는 확인 대상이 아니다', () => {
    expect(payReviewFlags(42, 0, '14:16', '15:01')).toEqual({ scheduled: 45, overSchedule: false, noBreak: false });
  });
  it('예정보다 30분 넘게 길면 확인 대상', () => {
    expect(payReviewFlags(75, 0, '14:16', '15:01').overSchedule).toBe(false);
    expect(payReviewFlags(76, 0, '14:16', '15:01').overSchedule).toBe(true);
    expect(payReviewFlags(225, 0, '14:16', '15:01').overSchedule).toBe(true);
  });
  it('4시간 이상인데 휴게가 0이면 확인 대상, 휴게를 넣었으면 아니다', () => {
    expect(payReviewFlags(540, 0, '09:00', '18:00').noBreak).toBe(true);
    expect(payReviewFlags(540, 60, '09:00', '18:00').noBreak).toBe(false);
    expect(payReviewFlags(239, 0, '09:00', '13:00').noBreak).toBe(false);
  });
});
