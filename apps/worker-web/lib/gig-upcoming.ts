export type UpcomingAssignment = {
  id: string; title: string; starts_on: string; ends_on: string; work_weekdays: number[];
  start_time: string; end_time: string; status: string; source?: string;
};

export function upcomingGigAssignments(assignments: UpcomingAssignment[], today: string) {
  // Match the attendance screen: admin assignments supersede compatibility
  // contract rows. Do not invent a shift from the broad employment contract.
  const schedule = assignments.some(item => item.source === 'admin') ? assignments.filter(item => item.source === 'admin') : assignments;
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const from = tomorrow.toISOString().slice(0, 10);
  return schedule.flatMap(item => {
    if (!['planned', 'active'].includes(item.status) || item.ends_on < from) return [];
    const cursor = new Date(`${item.starts_on > from ? item.starts_on : from}T00:00:00Z`);
    if (Number.isNaN(cursor.getTime())) return [];
    // The next matching weekday is at most seven days away.
    for (let day = 0; day < 7; day++, cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10);
      if (date > item.ends_on) return [];
      if ((item.work_weekdays ?? []).map(Number).includes(cursor.getUTCDay() || 7)) return [{ ...item, nextDate: date }];
    }
    return [];
  }).sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.start_time.localeCompare(b.start_time) || a.id.localeCompare(b.id));
}
