// 우리 직원 주간 근무표 — 등록해 둔 근무요일·요일별 시간·승인된 휴가를 한 주 표로 편다.
// "이번 주 토요일에 누가 나오나"를 직원 카드를 하나씩 열지 않고 본다(2026-11-10 치과원장 QA). 공고로 온 근무자는 다루지 않는다.
import { staffHoursOn } from './staff-schedule';
import { leaveTypeLabel } from './leave-label';

export type WeekStaff = {
  id: string; name: string; role: string; status: string;
  workWeekdays: number[]; baseStart: string; baseEnd: string; weekdayHours?: unknown;
  contractStart: string | null; contractEnd: string | null;
};
export type WeekLeave = { staff_id: string; leave_type: string; start_date: string; end_date: string | null; status: string; half_day_period?: string | null };
// work=근무, off=쉬는 요일, leave=종일 휴가, paused=휴직, out=입사 전·계약 종료 뒤
export type WeekCell = { date: string; kind: 'work' | 'off' | 'leave' | 'paused' | 'out'; start?: string; end?: string; custom?: boolean; leaveLabel?: string; leavePending?: boolean };
export type WeekRow = { id: string; name: string; role: string; cells: WeekCell[] };

const DAY_MS = 86_400_000;
// 하루를 다 쉬는 종류. 반차·반반차·시간차는 그날 근무가 남아 있어 근무 칸에 꼬리표로 붙인다
const FULL_DAY_LEAVE = new Set(['annual', 'sick', 'other']);

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
/** 그 날짜가 속한 주의 월요일 */
export function weekStartOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return addDays(date, 1 - day);
}
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function leaveOn(leaves: WeekLeave[], staffId: string, date: string, status: string) {
  const hits = leaves.filter((l) => l.staff_id === staffId && l.status === status && l.start_date <= date && (l.end_date ?? l.start_date) >= date);
  // 같은 날 종일 휴가와 반차가 겹치면 종일 휴가를 보여 준다
  return hits.find((l) => FULL_DAY_LEAVE.has(l.leave_type)) ?? hits[0] ?? null;
}

export function buildWeekSchedule(staff: WeekStaff[], leaves: WeekLeave[], weekStart: string): { dates: string[]; rows: WeekRow[]; headcount: number[] } {
  const dates = weekDates(weekStart);
  const rows = staff.map((person) => ({
    id: person.id, name: person.name, role: person.role,
    cells: dates.map((date, index): WeekCell => {
      if ((person.contractStart && date < person.contractStart) || (person.contractEnd && date > person.contractEnd)) return { date, kind: 'out' };
      if (!person.workWeekdays.includes(index + 1)) return { date, kind: 'off' };
      if (person.status === 'leave') return { date, kind: 'paused' };
      const approved = leaveOn(leaves, person.id, date, 'approved');
      if (approved && FULL_DAY_LEAVE.has(approved.leave_type)) return { date, kind: 'leave', leaveLabel: leaveTypeLabel(approved.leave_type, approved.half_day_period, '휴가') };
      const hours = staffHoursOn({ defaultStart: person.baseStart, defaultEnd: person.baseEnd, weekdayHours: person.weekdayHours }, date);
      const tag = approved ?? leaveOn(leaves, person.id, date, 'pending');
      return {
        date, kind: 'work', start: hours.start.slice(0, 5), end: hours.end.slice(0, 5), custom: hours.custom,
        ...(tag ? { leaveLabel: leaveTypeLabel(tag.leave_type, tag.half_day_period, '휴가'), leavePending: tag.status === 'pending' } : {}),
      };
    }),
  }));
  const headcount = dates.map((_, index) => rows.filter((row) => row.cells[index].kind === 'work').length);
  return { dates, rows, headcount };
}
