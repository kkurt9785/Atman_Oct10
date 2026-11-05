import { describe, expect, it } from 'vitest';
import { attendanceHelpDraft, attendanceWindow, attendanceWindowLine } from '../attendance-window';

describe('attendanceWindow — record_unified_attendance TIME_NOT_ALLOWED 와 같은 창', () => {
  it('설정 행이 없으면 서버 기본값 60/60/60/120', () => {
    expect(attendanceWindow('09:00:00', '18:00:00', null)).toEqual({ checkIn: '08:00~10:00', checkOut: '17:00~20:00' });
  });
  it('근무지 설정 분을 쓴다 (null 은 기본값)', () => {
    expect(attendanceWindow('09:30', '17:00', { check_in_before_minutes: 30, check_in_after_minutes: 15, check_out_before_minutes: 0, check_out_after_minutes: null }))
      .toEqual({ checkIn: '09:00~09:45', checkOut: '17:00~19:00' });
  });
  it('근무일(한국 시간 하루) 밖으로 넘치는 부분은 잘린다 — 자정 넘으면 서버가 다음 근무일로 본다', () => {
    expect(attendanceWindow('00:30', '09:00', null)).toEqual({ checkIn: '00:00~01:30', checkOut: '08:00~11:00' });
    expect(attendanceWindow('14:00', '23:00', null)).toEqual({ checkIn: '13:00~15:00', checkOut: '22:00~23:59' });
  });
  it('밤샘 근무는 종료 시각 전까지 전날 근무 — 퇴근은 종료 시각 직전까지만', () => {
    expect(attendanceWindow('22:00', '06:00', null)).toEqual({ checkIn: '21:00~23:00', checkOut: '05:00~05:59' });
  });
  it('시간이 없거나 이상하면 null', () => {
    expect(attendanceWindow(null, '18:00', null)).toBeNull();
    expect(attendanceWindow('25:00', '18:00', null)).toBeNull();
  });
});

describe('attendanceWindowLine', () => {
  const allowed = { checkIn: '08:00~10:00', checkOut: '17:00~20:00' };
  it('출근 전은 둘 다, 출근 뒤는 퇴근만', () => {
    expect(attendanceWindowLine(allowed, 'check_in')).toBe('출근은 08:00~10:00 · 퇴근은 17:00~20:00에 눌러요');
    expect(attendanceWindowLine(allowed, 'check_out')).toBe('퇴근은 17:00~20:00에 눌러요');
    expect(attendanceWindowLine(null, 'check_in')).toBeNull();
  });
});

describe('attendanceHelpDraft', () => {
  it('실패한 시각(한국 시간)으로 사장님께 보낼 첫 문장', () => {
    const at = new Date('2026-11-05T00:07:00Z'); // KST 09:07
    expect(attendanceHelpDraft('check_in', at)).toBe('오늘 09:07 출근했는데 기록이 안 돼요');
    expect(attendanceHelpDraft('check_out', at)).toBe('오늘 09:07 퇴근했는데 기록이 안 돼요');
  });
});
