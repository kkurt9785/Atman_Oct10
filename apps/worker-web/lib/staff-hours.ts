// 직원의 '그날' 예정 근무시간.
// 기본은 facility_staff.default_start_time / default_end_time 이고, 사업장이 요일별 시간(weekday_hours)을 정해 두면
// 그 요일만 바꿔 쓴다 — 치과처럼 토요일만 09:00~13:00 인 곳이 있어서다 (20261110100000 마이그레이션).
// 서버 record_unified_attendance 와 같은 순서: 근무일을 기본 시간으로 먼저 정하고, 그 근무일의 ISO 요일(월=1 … 일=7) 값을 적용한다.
export type WeekdayHours = Record<string, { start?: string | null; end?: string | null } | null | undefined>;
export type StaffHoursSource = {
  default_start_time: string;
  default_end_time: string;
  weekday_hours?: WeekdayHours | null;
};
export type StaffHours = { start: string; end: string; custom: boolean };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD 의 ISO 요일. 월=1 … 일=7. 형식이 틀리면 null */
export function isoWeekday(dateStr: string): number | null {
  const time = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  return new Date(time).getUTCDay() || 7;
}

/** 그 근무일의 시작·종료. 요일 값이 없거나 형식이 어긋나면(start>=end 포함 — 요일 값은 야간 넘김이 없다) 기본 시간 그대로 */
export function staffHoursOn(staff: StaffHoursSource, dateStr: string): StaffHours {
  const fallback = { start: staff.default_start_time, end: staff.default_end_time, custom: false };
  const weekday = isoWeekday(dateStr);
  const value = weekday == null ? null : staff.weekday_hours?.[String(weekday)];
  const start = value?.start?.slice(0, 5), end = value?.end?.slice(0, 5);
  if (!start || !end || !HHMM.test(start) || !HHMM.test(end) || start >= end) return fallback;
  return { start, end, custom: true };
}

/** 지금 속한 근무일(KST). 야간 근무자(기본 종료 ≤ 시작)는 종료 시각 전까지 전날 근무로 친다 — lib/attendance-window.ts 와 같은 기준 */
export function staffWorkDate(staff: Pick<StaffHoursSource, 'default_start_time' | 'default_end_time'>, now: Date = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const clock = kst.toISOString().slice(11, 16);
  const start = staff.default_start_time.slice(0, 5), end = staff.default_end_time.slice(0, 5);
  const overnight = end <= start;
  return new Date(kst.getTime() - (overnight && clock < end ? DAY_MS : 0)).toISOString().slice(0, 10);
}

/** select 에 넣은 컬럼이 DB 에 아직 없을 때(PostgREST 42703). 마이그레이션보다 앱이 먼저 나가도 화면이 열리도록, 이때만 그 컬럼을 빼고 다시 읽는다 */
export function isMissingColumnError(error: { code?: string | null } | null | undefined) {
  return error?.code === '42703' || error?.code === 'PGRST204';
}
