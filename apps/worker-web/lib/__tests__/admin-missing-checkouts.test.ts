import { describe, expect, it } from 'vitest';
import { missingCheckoutHref, sortMissingCheckouts, takeOldest, type MissingCheckout } from '../../../admin-web/lib/missing-checkouts';
import { attendanceReviewCount } from '../../../admin-web/lib/today-headcount';

// 2026-11-13 퇴근 누락 조치 목록 (docs/attendance/DECISIONS.md D2)
const row = (id: string, workDate: string, checkInAt: string, kind: 'staff' | 'shift' = 'staff'): MissingCheckout =>
  ({ id, kind, name: id, workDate, checkInAt, scheduledEnd: '18:00:00', flaggedAt: '2026-11-13T00:00:00Z' });

describe('퇴근 누락 목록', () => {
  it('오래된 근무일부터, 같은 날은 먼저 출근한 순', () => {
    const sorted = sortMissingCheckouts([
      row('c', '2026-11-12', '2026-11-12T00:00:00Z'),
      row('a', '2026-10-30', '2026-10-30T01:00:00Z', 'shift'),
      row('b', '2026-11-12', '2026-11-11T23:30:00Z'),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('직원 근태와 공고 근무를 섞어도 50건까지만', () => {
    const rows = Array.from({ length: 70 }, (_, i) => row(`r${i}`, `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, `2026-10-01T00:${String(i % 60).padStart(2, '0')}:00Z`, i % 2 ? 'shift' : 'staff'));
    const top = takeOldest(rows);
    expect(top).toHaveLength(50);
    expect(top[0].workDate).toBe('2026-10-01');
  });

  it('정리 링크는 그 근무일 달의 근태 기록, 해당 기록 위치', () => {
    expect(missingCheckoutHref({ id: 'x1', kind: 'staff', workDate: '2026-10-31' })).toBe('/attendance-history?month=2026-10#att-staff-x1');
    expect(missingCheckoutHref({ id: 'y2', kind: 'shift', workDate: '2026-11-01' })).toBe('/attendance-history?month=2026-11#att-shift-y2');
  });

  it('홈 출퇴근 확인 숫자에 퇴근 누락 전체 건수가 더해진다(지난 기록 포함)', () => {
    const staff = [{ attendanceStatus: 'checkout_pending' }, { attendanceStatus: 'working' }];
    expect(attendanceReviewCount(staff, 1, 2)).toBe(4);
    expect(attendanceReviewCount(staff, 1, 2, 3)).toBe(7);
  });
});

// D5 — 미퇴근으로 표시된 지난 기록이 오늘 출근을 가리지 않는다
import { currentStaffAttendance, isOpenAttendance } from '../workplace-selection';
import { currentGigAttendances } from '../attendance-feedback';

describe('미퇴근 표시된 기록과 오늘 출근', () => {
  type Row = { staff_id: string; work_date: string; check_in_at: string | null; check_out_at: string | null; status: string; missing_checkout_at?: string | null };
  const yesterday: Row = { staff_id: 's', work_date: '2026-11-12', check_in_at: '2026-11-12T09:00:00+09:00', check_out_at: null, status: 'working' };
  const today: Row = { staff_id: 's', work_date: '2026-11-13', check_in_at: null, check_out_at: null, status: 'scheduled' };

  it('퇴근 가능 시간 안의 열린 기록은 그대로 우선(야간 근무 보호)', () => {
    expect(isOpenAttendance(yesterday)).toBe(true);
    expect(currentStaffAttendance([today], [yesterday], '2026-11-13').s).toEqual(yesterday);
    expect(currentGigAttendances([today, yesterday], '2026-11-13').s).toEqual(yesterday);
  });

  it('미퇴근으로 표시되면 오늘 기록으로 넘어가 출근할 수 있다', () => {
    const flagged = { ...yesterday, missing_checkout_at: '2026-11-12T11:07:00Z' };
    expect(isOpenAttendance(flagged)).toBe(false);
    expect(currentStaffAttendance([today], [flagged], '2026-11-13').s).toEqual(today);
    expect(currentGigAttendances([today, flagged], '2026-11-13').s).toEqual(today);
  });

  it('오늘 기록이 아직 없으면 비어 있어 출근 전으로 보인다', () => {
    const flagged = { ...yesterday, missing_checkout_at: '2026-11-12T11:07:00Z' };
    expect(currentStaffAttendance([], [flagged], '2026-11-13').s).toBeUndefined();
  });
});
