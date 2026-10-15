import { slotOf, SLOT_NAME, PHARMACY_SLOT_NAME } from './roster';

// 종류는 코드로, 문구는 표시용으로 — 문구를 바꿔도 분기가 깨지지 않게
export type AgendaKind = 'staff' | 'pending' | 'invited' | 'confirmed' | 'active' | 'done' | 'missed';
export const AGENDA_STATUS: Record<AgendaKind, string> = { staff: '계약 기준 예정', pending: '지원 대기', invited: '수락 요청', confirmed: '확정', active: '근무 중', done: '완료', missed: '기록 없음' };
export const isPendingKind = (kind: AgendaKind) => kind === 'pending' || kind === 'invited';
export type AgendaItem = { id: string; date: string; start: string; end: string; facility: string; kind: AgendaKind; status: string; href: string; active?: boolean; slot?: string };

// 시간대 이름 — 간호사는 데이·이브닝·나이트, 약국 직군은 오전·오후·야간 (근무표 용어 규칙)
export function slotLabel(start: string, role?: string | null) {
  const slot = slotOf(start);
  return role === 'pharmacist' || role === 'pharmacy_staff' ? PHARMACY_SLOT_NAME[slot] : SLOT_NAME[slot];
}
export type StaffPlan = { id: string; contract_start: string | null; contract_end: string | null; work_weekdays: number[]; default_start_time: string; default_end_time: string; facilities: { name: string } | { name: string }[] | null };
export function staffAgenda(staff: StaffPlan[], from: string, days = 42, role?: string | null): AgendaItem[] {
  const result: AgendaItem[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(`${from}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + offset);
    const date = day.toISOString().slice(0, 10), weekday = day.getUTCDay() || 7;
    for (const row of staff) {
      if ((row.contract_start && date < row.contract_start) || (row.contract_end && date > row.contract_end) || !row.work_weekdays?.includes(weekday)) continue;
      const facility = Array.isArray(row.facilities) ? row.facilities[0] : row.facilities;
      result.push({ id: `staff-${row.id}-${date}`, date, start: row.default_start_time, end: row.default_end_time, facility: facility?.name || '내 사업장', kind: 'staff', status: AGENDA_STATUS.staff, slot: slotLabel(row.default_start_time, role), href: `/workplace?staffId=${row.id}` });
    }
  }
  return result;
}
export function sortAgenda(items: AgendaItem[]) {
  return [...items].sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`) || a.id.localeCompare(b.id));
}
export function agendaTime(item: AgendaItem) {
  return `${item.start.slice(0, 5)}–${item.end.slice(0, 5)}${item.end <= item.start ? ' (익일)' : ''}`;
}
export function agendaEndsAt(item: AgendaItem) {
  const start = Date.parse(`${item.date}T${item.start.slice(0, 5)}:00+09:00`);
  let end = Date.parse(`${item.date}T${item.end.slice(0, 5)}:00+09:00`);
  if (end <= start) end += 86400000;
  return end;
}
