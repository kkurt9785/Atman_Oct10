export type AgendaItem = { id: string; date: string; start: string; end: string; facility: string; status: string; href: string; active?: boolean };
export type StaffPlan = { id: string; contract_start: string | null; contract_end: string | null; work_weekdays: number[]; default_start_time: string; default_end_time: string; facilities: { name: string } | { name: string }[] | null };
export function staffAgenda(staff: StaffPlan[], from: string, days = 42): AgendaItem[] {
  const result: AgendaItem[] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(`${from}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + offset);
    const date = day.toISOString().slice(0, 10), weekday = day.getUTCDay() || 7;
    for (const row of staff) {
      if ((row.contract_start && date < row.contract_start) || (row.contract_end && date > row.contract_end) || !row.work_weekdays?.includes(weekday)) continue;
      const facility = Array.isArray(row.facilities) ? row.facilities[0] : row.facilities;
      result.push({ id: `staff-${row.id}-${date}`, date, start: row.default_start_time, end: row.default_end_time, facility: facility?.name || '내 사업장', status: '계약 기준 예정', href: `/workplace?staffId=${row.id}` });
    }
  }
  return result;
}
export function sortAgenda(items: AgendaItem[]) {
  return [...items].sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`) || a.id.localeCompare(b.id));
}
export function agendaTime(item: AgendaItem) {
  return `${item.start.slice(0, 5)}–${item.end.slice(0, 5)}${item.end <= item.start ? ' (다음 날)' : ''}`;
}
export function agendaEndsAt(item: AgendaItem) {
  const start = Date.parse(`${item.date}T${item.start.slice(0, 5)}:00+09:00`);
  let end = Date.parse(`${item.date}T${item.end.slice(0, 5)}:00+09:00`);
  if (end <= start) end += 86400000;
  return end;
}
