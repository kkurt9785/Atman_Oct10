import { describe, expect, it } from 'vitest';
import { formatLeaveAmount, leaveRequestLine, leaveTypeLabel } from '@/lib/leave-display';

describe('formatLeaveAmount — 휴가는 일 단위로 먼저, 시간은 괄호로', () => {
  it('하루는 8시간(480분)이다', () => {
    expect(formatLeaveAmount(7200)).toBe('15일 (120시간)');
    expect(formatLeaveAmount(480)).toBe('1일 (8시간)');
    expect(formatLeaveAmount(960)).toBe('2일 (16시간)');
  });
  it('반차·반반차는 소수 일로', () => {
    expect(formatLeaveAmount(240)).toBe('0.5일 (4시간)');
    expect(formatLeaveAmount(120)).toBe('0.25일 (2시간)');
    expect(formatLeaveAmount(7080)).toBe('14.75일 (118시간)');
  });
  it('2시간 단위로 안 떨어지면 일과 시간을 나눠 적고, 하루 미만이면 시간만', () => {
    expect(formatLeaveAmount(6780)).toBe('14일 1시간 (113시간)');
    expect(formatLeaveAmount(60)).toBe('1시간');
    expect(formatLeaveAmount(90)).toBe('1.5시간');
  });
  it('없는 값·음수는 0일', () => {
    expect(formatLeaveAmount(null)).toBe('0일 (0시간)');
    expect(formatLeaveAmount(undefined)).toBe('0일 (0시간)');
    expect(formatLeaveAmount(-30)).toBe('0일 (0시간)');
  });
});

describe('leaveRequestLine — 신청 내역 한 줄에 휴가 종류가 보인다', () => {
  it('여러 날 연차는 기간과 일수', () => {
    expect(leaveRequestLine({ leave_type: 'annual', start_date: '2026-11-11', end_date: '2026-11-12', requested_minutes: 960 })).toBe('연차 · 2026-11-11~11-12 · 2일 (16시간)');
  });
  it('하루짜리는 날짜 하나만', () => {
    expect(leaveRequestLine({ leave_type: 'half_day', start_date: '2026-11-11', end_date: '2026-11-11', requested_minutes: 240 })).toBe('반차 · 2026-11-11 · 0.5일 (4시간)');
  });
  it('모르는 종류는 그냥 휴가', () => {
    expect(leaveTypeLabel('sick')).toBe('병가');
    expect(leaveTypeLabel('maternity')).toBe('휴가');
    expect(leaveTypeLabel(null)).toBe('휴가');
  });
});
