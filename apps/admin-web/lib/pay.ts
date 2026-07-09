export const MIN_HOURLY_WAGE_2026 = 10320;

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

export function calcEstimatedShiftPay(startTime: string, endTime: string, hourlyWage: number): number | null {
  const minutes = calcShiftMinutes(startTime, endTime);
  if (minutes == null || !Number.isFinite(hourlyWage) || hourlyWage < MIN_HOURLY_WAGE_2026) {
    return null;
  }
  return Math.round((minutes / 60) * hourlyWage);
}
