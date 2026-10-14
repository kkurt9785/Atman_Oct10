import { describe, expect, it } from 'vitest';
import { payoutDateKST, summarizeAttendancePeriod } from '../shared/gig-pay/calculation';
const attendance = (date: string, breakMinutes = 0) => ({ work_date: date, status: 'completed', check_in_at: `${date}T09:00:00+09:00`, check_out_at: `${date}T11:00:00+09:00`, break_minutes: breakMinutes });
describe('정산 월·주 경계', () => {
  it('이전 달 기록은 이번 주에는 포함하고 이번 달에는 포함하지 않는다', () => {
    const rows = [attendance('2026-09-30'), attendance('2026-10-01', 30)];
    expect(summarizeAttendancePeriod(rows, '2026-09-28', '2026-10-04')).toEqual({ minutes: 210, days: 2 });
    expect(summarizeAttendancePeriod(rows, '2026-10-01', '2026-10-31')).toEqual({ minutes: 90, days: 1 });
  });
  it('한 날짜의 여러 근태는 일수를 중복하지 않고 잘못된·미완료 기록을 제외한다', () => {
    const row = attendance('2026-10-01');
    const rows = [row, row, { ...row, status: 'working' }, { ...row, check_out_at: 'invalid' }, { ...row, check_out_at: '2026-09-30T09:00:00+09:00' }];
    expect(summarizeAttendancePeriod(rows, '2026-10-01', '2026-10-31')).toEqual({ minutes: 240, days: 1 });
  });
  it('지급 월은 UTC가 아닌 한국 시각으로 판단한다', () => {
    expect(payoutDateKST('2026-09-30T15:10:00Z', null)).toBe('2026-10-01');
    expect(payoutDateKST(null, '2026-10-01')).toBe('2026-10-01');
    expect(payoutDateKST('invalid', null)).toBe('');
  });
});
