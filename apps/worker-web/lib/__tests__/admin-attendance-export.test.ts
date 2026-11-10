import { describe, expect, it } from 'vitest';
import { ATTENDANCE_EXPORT_HEADER, attendanceExportRow, attendanceExportRows, kstClock, kstDate, minutesText, staffMonthStats, weekdayOf } from '../../../admin-web/lib/attendance-export';
import { PAYROLL_EXPORT_HEADER, leaveDaysText, shiftExportRow, staffExportRow } from '../../../admin-web/lib/payroll-export';
import { csvAttachment } from '../../../admin-web/lib/csv';

// 2026-11-10 치과원장 QA P0-A·P1-F — 원장이 엑셀로 여는 근태·급여 CSV는 한국 시간·한글 상태로, 내부 ID 없이 나온다
const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1', kind: 'staff' as const, staffId: 's1', name: '김민서', employment: 'regular', role: '치과위생사', workDate: '2026-11-10',
  scheduledStart: '09:00:00', scheduledEnd: '18:00:00', checkInAt: '2026-11-09T23:58:00+00:00', checkOutAt: '2026-11-10T09:02:00+00:00',
  breakMinutes: 60, workedMinutes: 484, status: 'completed', method: 'GPS', lateMinutes: 0, earlyLeaveMinutes: 0, correctionReason: null, ...over,
});

describe('근태 CSV', () => {
  it('출퇴근 시각을 한국 시간으로 쓴다', () => {
    expect(kstClock('2026-11-09T23:58:00+00:00', '2026-11-10')).toBe('08:58');
    expect(kstClock('2026-11-10T15:30:00Z', '2026-11-10')).toBe('다음날 00:30');
    expect(kstClock('2026-11-12T01:00:00Z', '2026-11-10')).toBe('11/12 10:00');
    expect(kstClock(null, '2026-11-10')).toBe('');
    expect(kstDate('2026-11-10T16:00:00Z')).toBe('2026-11-11');
  });

  it('상태·인증 방식은 한글, 내부 ID 열은 없다', () => {
    const cells = attendanceExportRow(row());
    expect(cells).toHaveLength(ATTENDANCE_EXPORT_HEADER.length);
    expect(cells.slice(0, 9)).toEqual(['2026-11-10', '화', '김민서', '직원', '완료', '09:00', '18:00', '08:58', '18:02']);
    expect(cells).toContain('위치');
    expect(cells).toContain('8시간 4분');
    expect(cells).not.toContain('s1');
    expect(ATTENDANCE_EXPORT_HEADER.join()).not.toMatch(/ID/);
    expect(attendanceExportRow(row({ status: 'late', lateMinutes: 12, method: 'QR_FALLBACK' }))).toEqual(expect.arrayContaining(['지각', 12, 'QR 보완']));
  });

  it('정산 전 공고 근무는 인정시간을 비우고, 날짜 오름차순으로 낸다', () => {
    const pending = attendanceExportRow(row({ kind: 'shift', staffId: null, recognitionPending: true }));
    expect(pending[3]).toBe('공고 근무');
    expect(pending.slice(9, 12)).toEqual(['', '', '']);
    const sorted = attendanceExportRows([row({ workDate: '2026-11-12' }), row({ workDate: '2026-11-03' })]);
    expect(sorted.map((cells) => cells[0])).toEqual(['2026-11-03', '2026-11-12']);
  });

  it('요일·시간 글자', () => {
    expect(weekdayOf('2026-11-08')).toBe('일');
    expect(minutesText(480)).toBe('8시간');
    expect(minutesText(45)).toBe('45분');
  });
});

describe('급여 CSV', () => {
  it('직원별 한 달 근태 요약을 센다', () => {
    const stats = staffMonthStats([
      row(), row({ status: 'late', lateMinutes: 10 }), row({ earlyLeaveMinutes: 30 }),
      row({ status: 'absent', checkInAt: null, checkOutAt: null }), row({ kind: 'shift', staffId: null }),
    ]);
    expect(stats.get('s1')).toEqual({ attendDays: 3, lateCount: 1, earlyLeaveCount: 1, absentDays: 1 });
  });

  it('직원 행은 한글 상태·근태 요약을 담고 내부 ID를 담지 않는다', () => {
    const cells = staffExportRow({
      saved: false, status: 'collecting', needsProration: false, grossAmount: 2_800_000, netAmount: 2_800_000, periodMonth: '2026-11-01',
      workerName: '김민서', workedMinutes: 9_690, excludedRecords: 1, bankName: null, accountLast4: null,
    }, { attendDays: 20, lateCount: 1, earlyLeaveCount: 0, absentDays: 0 }, 720);
    expect(cells).toHaveLength(PAYROLL_EXPORT_HEADER.length);
    expect(cells.slice(0, 10)).toEqual(['사업장 등록 직원', '2026-11', '김민서', '161시간 30분', 20, 1, 0, 0, 1.5, 1]);
    expect(cells).toContain('집계 중');
    expect(cells).not.toContain('collecting');
    expect(PAYROLL_EXPORT_HEADER.join()).not.toMatch(/ID/);
    expect(leaveDaysText(240)).toBe(0.5);
  });

  it('공고 지원 인력 행도 같은 칸 수·한글 상태', () => {
    const cells = shiftExportRow({ shiftDate: '2026-11-07', startTime: '09:00:00', endTime: '18:00:00', workerName: '이도윤', grossAmount: 120_000, netAmount: 120_000, deductionStatus: 'unconfirmed', status: 'draft', paidDate: '' });
    expect(cells).toHaveLength(PAYROLL_EXPORT_HEADER.length);
    expect(cells).toEqual(expect.arrayContaining(['09:00~18:00', '검토 전', '미확정 · 사업장 확인 필요']));
  });

  it('파일 이름은 한글, 못 읽는 브라우저용 영문 이름을 함께 보낸다', () => {
    expect(csvAttachment('attendance-2026-11.csv', '근태기록_2026-11.csv')).toBe(`attachment; filename="attendance-2026-11.csv"; filename*=UTF-8''${encodeURIComponent('근태기록_2026-11.csv')}`);
  });
});
