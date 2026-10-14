export const MIN_HOURLY_WAGE_2026 = 10320;
import { shiftHourlyWageError, wageTodayKST } from './shared/gig-pay/minimum-wage';
export { hourlyWageError, shiftHourlyWageError, lastWorkDate, minimumHourlyWage, staffPayPeriod, wageTodayKST } from './shared/gig-pay/minimum-wage';

function parseTimeToMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function calcBreakMinutes(workedMinutes: number): number {
  if (workedMinutes >= 480) return 60;
  if (workedMinutes >= 240) return 30;
  return 0;
}

export function calcShiftMinutes(startTime: string, endTime: string): number | null {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return null;

  let total = end - start;
  if (total <= 0) total += 24 * 60;
  return total - calcBreakMinutes(total);
}

export function calcEstimatedShiftPay(startTime: string, endTime: string, hourlyWage: number, workDate?: string): number | null {
  const minutes = calcShiftMinutes(startTime, endTime);
  if (minutes == null || shiftHourlyWageError(hourlyWage, workDate ?? wageTodayKST(), startTime, endTime)) {
    return null;
  }
  return Math.round((minutes / 60) * hourlyWage);
}

// 주휴수당(근로기준법 §55): 주 소정근로 15시간 이상 + 개근이면 1일분 유급. 환산 (주 소정/40)×8×시급.
// packages/wage-engine calcWeeklyHolidayPay 와 같은 식 — 화면 안내용 '약' 금액이고, 지급액에 자동으로 더하지는 않는다
export const WEEKLY_HOLIDAY_MIN_MINUTES = 15 * 60;
export function weeklyHolidayPay(weeklyMinutes: number, hourlyWage: number): number {
  if (weeklyMinutes < WEEKLY_HOLIDAY_MIN_MINUTES || hourlyWage <= 0) return 0;
  const paidHours = (Math.min(weeklyMinutes, 40 * 60) / (40 * 60)) * 8;
  return Math.round(paidHours * hourlyWage);
}
// 이번 주(월~일, KST) 범위
export function currentWeekRangeKST(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay() || 7; // 월=1 … 일=7
  const monday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - (day - 1)));
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}
