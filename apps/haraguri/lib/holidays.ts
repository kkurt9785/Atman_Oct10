// Korean public holidays as a static table (대체공휴일 included). Extend yearly; the calendar only reads this map.
export const HOLIDAYS: Record<string, string> = {
  '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절', '2026-03-02': '대체공휴일', '2026-05-05': '어린이날', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일',
  '2026-06-03': '지방선거', '2026-06-06': '현충일', '2026-08-15': '광복절', '2026-08-17': '대체공휴일',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
  '2027-01-01': '신정', '2027-02-05': '설날 연휴', '2027-02-06': '설날', '2027-02-07': '설날 연휴', '2027-02-08': '대체공휴일',
  '2027-03-01': '삼일절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날', '2027-06-06': '현충일', '2027-08-15': '광복절', '2027-08-16': '대체공휴일',
  '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴', '2027-10-03': '개천절', '2027-10-04': '대체공휴일', '2027-10-09': '한글날', '2027-10-11': '대체공휴일',
  '2027-12-25': '성탄절', '2027-12-27': '대체공휴일',
};
export const holidayName = (date: string) => HOLIDAYS[date];
export function weekday(date: string) { return new Date(`${date}T12:00:00`).getDay(); } // 0 = Sunday, local
// Class names drive the red/blue weekend colouring Korean calendars use.
export function dayTone(date: string): 'holiday' | 'sun' | 'sat' | '' {
  if (HOLIDAYS[date]) return 'holiday';
  const d = weekday(date);
  return d === 0 ? 'sun' : d === 6 ? 'sat' : '';
}
export function weekOf(date: string): string[] {
  const start = new Date(`${date}T12:00:00`);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
}
