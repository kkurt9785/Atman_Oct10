// Verified 2026-10-14 against MOEL's 2027 final notice (2026-08-05).
// https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=19744
// Keep the SQL rule in 20261015000000_year_aware_minimum_wage.sql in sync.
const RATES: Readonly<Record<number, number>> = { 2026: 10320, 2027: 10700 };

export function wageTodayKST(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function yearOf(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return parsed.getUTCFullYear();
}

// A single fixed rate for a multi-year period must meet every included year.
// Unknown years never silently inherit an older rate.
export function minimumHourlyWage(start = wageTodayKST(), end = start): number | null {
  const first = yearOf(start), last = yearOf(end);
  if (first === null || last === null || end < start) return null;
  let minimum = 0;
  for (let year = first; year <= last; year++) {
    if (!RATES[year]) return null;
    minimum = Math.max(minimum, RATES[year]);
  }
  return minimum;
}

export function hourlyWageError(rate: number, start = wageTodayKST(), end = start): string | null {
  const minimum = minimumHourlyWage(start, end);
  if (minimum === null) return '근무 날짜를 확인해 주세요. 해당 기간의 최저시급 기준이 등록되지 않아 저장할 수 없어요.';
  if (!Number.isInteger(rate) || rate < minimum) return `선택한 근무 기간의 시급은 ${minimum.toLocaleString('ko-KR')}원 이상이어야 해요.`;
  return null;
}

export function lastWorkDate(date: string, startTime: string, endTime: string): string {
  if (yearOf(date) === null || !startTime || !endTime || endTime > startTime) return date;
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function shiftHourlyWageError(rate: number, date: string, startTime: string, endTime: string): string | null {
  return hourlyWageError(rate, date, lastWorkDate(date, startTime, endTime));
}

// Staff pay settings describe current/future work, not a rewrite of past wages.
export function staffPayPeriod(start?: string | null, end?: string | null, today = wageTodayKST()) {
  const from = start && start > today ? start : today;
  return { start: from, end: end && end > from ? end : from };
}
