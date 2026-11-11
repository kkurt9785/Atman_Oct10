// 근무 건의 기간과 요일이 맞는지 따지는 순수 함수. 요일은 1=월 … 7=일.
// 2026-11-11 단기 근로 QA: 토·일 행사를 넣어도 요일 기본값(월~금)이 그대로라 근무일이 0일인 근무 건이 경고 없이 만들어졌다.

const DAY = 86_400_000;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** 기간 안에 실제로 들어 있는 요일(중복 없이, 월→일 순). 날짜가 잘못됐거나 거꾸로면 빈 배열 */
export function weekdaysInPeriod(startsOn: string, endsOn: string): number[] {
  const start = parse(startsOn), end = parse(endsOn);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const days = new Set<number>();
  for (let time = start; time <= end && days.size < 7; time += DAY) days.add(new Date(time).getUTCDay() || 7);
  return [...days].sort((a, b) => a - b);
}

/** 기간 중 고른 요일에 해당하는 날 수 */
export function countWorkDays(startsOn: string, endsOn: string, weekdays: number[]): number {
  const start = parse(startsOn), end = parse(endsOn);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  let count = 0;
  for (let time = start; time <= end && count < 400; time += DAY) if (weekdays.includes(new Date(time).getUTCDay() || 7)) count += 1;
  return count;
}

/** 기간이 엿새 이하면 그 기간의 요일로, 그보다 길면 원래 고른 요일 그대로 — 사장님이 요일을 직접 고르기 전까지만 쓴다 */
export function defaultWeekdaysFor(startsOn: string, endsOn: string, current: number[]): number[] {
  const inPeriod = weekdaysInPeriod(startsOn, endsOn);
  return inPeriod.length > 0 && inPeriod.length < 7 ? inPeriod : current;
}
