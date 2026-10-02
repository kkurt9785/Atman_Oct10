import { dateKST } from '@/lib/date';

// 근무표 문법. 간호사가 매일 보는 D·E·N 근무표를 앱의 첫 화면 문법으로 쓴다.
//   D 07–15 · E 15–23 · N 23–07
// 공고·확정 근무·초대 근무 모두 시작 시각으로 한 칸에 배정한다.
export type RosterSlot = 'D' | 'E' | 'N';
export const ROSTER_SLOTS: RosterSlot[] = ['D', 'E', 'N'];
export const SLOT_LABEL: Record<RosterSlot, string> = { D: '07–15', E: '15–23', N: '23–07' };
export const SLOT_NAME: Record<RosterSlot, string> = { D: '데이', E: '이브닝', N: '나이트' };

export function slotOf(startTime: string): RosterSlot {
  const hour = Number(startTime.slice(0, 2));
  if (hour >= 5 && hour < 12) return 'D';
  if (hour >= 12 && hour < 20) return 'E';
  return 'N';
}

export type RosterDay = { date: string; weekday: string; dayNumber: number; isToday: boolean; isWeekend: 'sat' | 'sun' | null };
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

// 오늘이 포함된 월~일 한 주 (KST)
export function currentWeek(): RosterDay[] {
  const today = dateKST();
  const todayDate = new Date(`${today}T00:00:00Z`);
  const offsetToMonday = (todayDate.getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => {
    const d = new Date(todayDate.getTime() + (index - offsetToMonday) * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    const weekdayIndex = d.getUTCDay();
    return {
      date,
      weekday: WEEKDAY[weekdayIndex],
      dayNumber: d.getUTCDate(),
      isToday: date === today,
      isWeekend: weekdayIndex === 6 ? 'sat' : weekdayIndex === 0 ? 'sun' : null,
    };
  });
}

export type RosterCellState = 'confirmed' | 'applied';
export type RosterCell = { count: number; state?: RosterCellState };
export type RosterCells = Record<string, RosterCell>;

export const cellKey = (date: string, slot: RosterSlot) => `${date}|${slot}`;

export function addCount(cells: RosterCells, date: string, startTime: string) {
  const key = cellKey(date, slotOf(startTime));
  const current = cells[key] ?? { count: 0 };
  cells[key] = { ...current, count: current.count + 1 };
}

export function setState(cells: RosterCells, date: string, startTime: string, state: RosterCellState) {
  const key = cellKey(date, slotOf(startTime));
  const current = cells[key] ?? { count: 0 };
  // 확정이 지원 중보다 우선
  if (current.state === 'confirmed') return;
  cells[key] = { ...current, state };
}

// 요일 반복 근무(긱워커 초대·병원 직원)를 이번 주 칸으로 펼친다. weekdays: 1=월 … 7=일
export function fillWeekdays(cells: RosterCells, week: RosterDay[], startTime: string, weekdays: number[] | null | undefined, contractStart?: string | null, contractEnd?: string | null) {
  const days = weekdays?.length ? weekdays : [1, 2, 3, 4, 5];
  for (const day of week) {
    const weekdayNumber = new Date(`${day.date}T00:00:00Z`).getUTCDay() || 7;
    if (!days.includes(weekdayNumber)) continue;
    if (contractStart && day.date < contractStart) continue;
    if (contractEnd && day.date > contractEnd) continue;
    setState(cells, day.date, startTime, 'confirmed');
  }
}

// 기본 선택 칸: 오늘 중 공고가 있는 첫 칸, 없으면 이번 주 첫 공고 칸, 그것도 없으면 오늘 D
export function defaultSelection(week: RosterDay[], cells: RosterCells): { date: string; slot: RosterSlot } {
  const today = week.find((day) => day.isToday) ?? week[0];
  for (const slot of ROSTER_SLOTS) if ((cells[cellKey(today.date, slot)]?.count ?? 0) > 0) return { date: today.date, slot };
  for (const day of week) for (const slot of ROSTER_SLOTS) if ((cells[cellKey(day.date, slot)]?.count ?? 0) > 0) return { date: day.date, slot };
  return { date: today.date, slot: 'D' };
}
