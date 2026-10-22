// 공고(단기 근무) 예상 지급액 — 사장님 앱·근무자 앱·시연 시드가 같은 식을 쓴다.
// 휴게: 8시간 이상 60분, 4시간 이상 30분(근로기준법 §54). 야간 가산은 포함하지 않는다.
// 원 단위 반올림은 (분×시급)/60 순서 — DB 트리거 round(minutes*rate/60)와 같은 값이 나온다.
// (minutes/60)*rate 는 130분×12,345원처럼 .5 경계에서 1원 어긋나 지급 기록이 거부된다.

export function parseClockToMinutes(time: string | null | undefined): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(time ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function calcBreakMinutes(workedMinutes: number): number {
  if (workedMinutes >= 480) return 60;
  if (workedMinutes >= 240) return 30;
  return 0;
}

/** 시작~종료(자정 넘김 허용)에서 휴게를 뺀 인정 분. 형식이 틀리면 null */
export function calcShiftMinutes(startTime: string, endTime: string): number | null {
  const start = parseClockToMinutes(startTime);
  const end = parseClockToMinutes(endTime);
  if (start == null || end == null) return null;
  let total = end - start;
  if (total <= 0) total += 24 * 60;
  return total - calcBreakMinutes(total);
}

export function roundPay(minutes: number, hourlyWage: number): number {
  return Math.round((minutes * hourlyWage) / 60);
}

export function estimatedShiftPay(startTime: string, endTime: string, hourlyWage: number): number | null {
  const minutes = calcShiftMinutes(startTime, endTime);
  if (minutes == null || !Number.isFinite(hourlyWage) || hourlyWage <= 0) return null;
  return roundPay(minutes, hourlyWage);
}
