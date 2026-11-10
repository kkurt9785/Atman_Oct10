import { describe, expect, it } from 'vitest';
import { addDays, buildWeekSchedule, weekStartOf } from '../../../admin-web/lib/week-schedule';
import { leaveTypeLabel, splitLeaveChoice } from '../../../admin-web/lib/leave-label';

const person = { id: 's1', name: '김위생', role: '치과위생사', status: 'active', workWeekdays: [1, 2, 3, 4, 5, 6], baseStart: '09:00:00', baseEnd: '18:30:00', weekdayHours: { '6': { start: '09:00', end: '13:00' } }, contractStart: null, contractEnd: null };

describe('주간 근무표 — 한 주 표로 펴기', () => {
  it('어느 요일이든 그 주 월요일을 찾는다', () => {
    expect(weekStartOf('2026-11-10')).toBe('2026-11-09');
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09');
    expect(weekStartOf('2026-11-15')).toBe('2026-11-09');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
  it('근무요일은 시간, 쉬는 요일은 off, 토요일은 요일별 시간', () => {
    const { dates, rows, headcount } = buildWeekSchedule([person], [], '2026-11-09');
    expect(dates[0]).toBe('2026-11-09');
    expect(dates[6]).toBe('2026-11-15');
    expect(rows[0].cells[0]).toMatchObject({ kind: 'work', start: '09:00', end: '18:30', custom: false });
    expect(rows[0].cells[5]).toMatchObject({ kind: 'work', start: '09:00', end: '13:00', custom: true });
    expect(rows[0].cells[6].kind).toBe('off');
    expect(headcount).toEqual([1, 1, 1, 1, 1, 1, 0]);
  });
  it('종일 휴가는 인원에서 빠지고, 반차는 근무 칸에 오전·오후가 붙는다', () => {
    const leaves = [
      { staff_id: 's1', leave_type: 'annual', start_date: '2026-11-10', end_date: '2026-11-11', status: 'approved' },
      { staff_id: 's1', leave_type: 'half_day', start_date: '2026-11-12', end_date: '2026-11-12', status: 'approved', half_day_period: 'pm' },
      { staff_id: 's1', leave_type: 'annual', start_date: '2026-11-13', end_date: '2026-11-13', status: 'pending' },
    ];
    const { rows, headcount } = buildWeekSchedule([person], leaves, '2026-11-09');
    expect(rows[0].cells[1]).toMatchObject({ kind: 'leave', leaveLabel: '연차' });
    expect(rows[0].cells[2].kind).toBe('leave');
    expect(rows[0].cells[3]).toMatchObject({ kind: 'work', leaveLabel: '오후 반차', leavePending: false });
    // 신청 중인 휴가는 아직 근무로 세고 '신청' 표시만 한다
    expect(rows[0].cells[4]).toMatchObject({ kind: 'work', leaveLabel: '연차', leavePending: true });
    expect(headcount).toEqual([1, 0, 0, 1, 1, 1, 0]);
  });
  it('입사 전·계약 종료 뒤는 out, 휴직 중이면 근무요일이 paused', () => {
    const joined = buildWeekSchedule([{ ...person, contractStart: '2026-11-11', contractEnd: '2026-11-13' }], [], '2026-11-09');
    expect(joined.rows[0].cells.map((c) => c.kind)).toEqual(['out', 'out', 'work', 'work', 'work', 'out', 'out']);
    const paused = buildWeekSchedule([{ ...person, status: 'leave' }], [], '2026-11-09');
    expect(paused.rows[0].cells.map((c) => c.kind)).toEqual(['paused', 'paused', 'paused', 'paused', 'paused', 'paused', 'off']);
    expect(paused.headcount).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('관리자 휴가 글자 — 반차 오전·오후', () => {
  it('선택값을 종류와 시간대로 나눈다', () => {
    expect(splitLeaveChoice('half_day:am')).toEqual({ type: 'half_day', period: 'am' });
    expect(splitLeaveChoice('half_day')).toEqual({ type: 'half_day', period: null });
    expect(splitLeaveChoice('annual:am')).toEqual({ type: 'annual', period: null });
    expect(splitLeaveChoice('half_day:night')).toEqual({ type: 'half_day', period: null });
  });
  it('시간대가 있으면 오전·오후를 붙이고, 없던 예전 기록은 그냥 반차', () => {
    expect(leaveTypeLabel('half_day', 'am')).toBe('오전 반차');
    expect(leaveTypeLabel('half_day', 'pm')).toBe('오후 반차');
    expect(leaveTypeLabel('half_day', null)).toBe('반차');
    expect(leaveTypeLabel('annual', 'am')).toBe('연차');
    expect(leaveTypeLabel('other', null, '기타 휴가')).toBe('기타 휴가');
    expect(leaveTypeLabel('maternity')).toBe('휴가');
  });
});
