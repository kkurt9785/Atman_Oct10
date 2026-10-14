import { describe, expect, it } from 'vitest';
import { canOfferAttendanceQr, currentGigAttendances } from '../attendance-feedback';
import { liveDemoWindow } from '../../../admin-web/lib/live-demo';

describe('출퇴근 복구 동선', () => {
  it.each(['TIME_NOT_ALLOWED', 'NOT_ASSIGNED', 'DUPLICATE_ATTENDANCE', 'ADMIN_REQUIRED', 'NETWORK_ERROR', undefined])('QR로 해결할 수 없는 %s 오류에는 QR을 권하지 않는다', (reason) => {
    expect(canOfferAttendanceQr(reason)).toBe(false);
  });
  it.each(['GPS_ERROR', 'GPS_ACCURACY_LOW', 'QR_INVALID', 'QR_EXPIRED'])('%s 오류에는 QR 안내를 제공한다', (reason) => {
    expect(canOfferAttendanceQr(reason)).toBe(true);
  });
  it('오늘 예정 행보다 전날 출근한 야간 근무를 먼저 보여 준다', () => {
    const night = { staff_id: 's', work_date: '2026-10-13', check_in_at: '2026-10-13T23:00:00+09:00', check_out_at: null };
    const today = { staff_id: 's', work_date: '2026-10-14', check_in_at: null, check_out_at: null };
    expect(currentGigAttendances([today, night], today.work_date).s).toEqual(night);
    expect(currentGigAttendances([today, { ...night, check_out_at: '2026-10-14T04:00:00+09:00' }], today.work_date).s).toEqual(today);
  });
  it.each([
    ['2026-10-14T10:01:00+09:00', '2026-10-14', '10:15', '11:00'],
    ['2026-10-14T10:15:00+09:00', '2026-10-14', '10:30', '11:15'],
    ['2026-10-14T23:44:59+09:00', '2026-10-14', '23:45', '00:30'],
    ['2026-12-31T23:59:00+09:00', '2027-01-01', '00:00', '00:45'],
  ])('시연 %s → %s %s~%s', (now, shiftDate, startTime, endTime) => {
    const window = liveDemoWindow(new Date(now).getTime());
    expect(window).toEqual({ shiftDate, startTime, endTime });
    expect(new Date(`${shiftDate}T${startTime}:00+09:00`).getTime()).toBeGreaterThan(new Date(now).getTime());
  });
});
