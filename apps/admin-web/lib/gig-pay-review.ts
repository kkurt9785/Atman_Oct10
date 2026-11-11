// 지급 전에 사장님이 한 번 봐야 하는 근무를 가려내는 순수 함수.
// 2026-11-11 단기 근로 QA: 금액은 실제 출퇴근 시각으로 계산한다. 그래서 예정보다 길게 찍힌 근무와
// 휴게를 넣지 않은 긴 근무가 표시 없이 금액에 들어갔다. 계산 규칙은 그대로 두고, 확인할 근무만 알려 준다.

/** 예정보다 이만큼 넘게 길면 확인 대상 */
export const OVER_SCHEDULE_MINUTES = 30;
/** 이만큼 이상 일했는데 휴게 기록이 0이면 확인 대상(4시간 근무에 휴게 30분이 법정 최소) */
export const LONG_WORK_MINUTES = 240;

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** 예정 근무 분(끝이 시작보다 이르거나 같으면 자정을 넘긴 근무). 예정이 없으면 null */
export function scheduledSpanMinutes(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end || !/^\d{2}:\d{2}/.test(start) || !/^\d{2}:\d{2}/.test(end)) return null;
  const span = toMinutes(end) - toMinutes(start);
  return span > 0 ? span : span + 24 * 60;
}

/** rawMinutes: 출근~퇴근 전체 분(휴게 빼기 전), breakMinutes: 실제로 뺀 휴게 */
export function payReviewFlags(rawMinutes: number, breakMinutes: number, scheduledStart?: string | null, scheduledEnd?: string | null) {
  const scheduled = scheduledSpanMinutes(scheduledStart, scheduledEnd);
  return {
    scheduled,
    overSchedule: scheduled !== null && rawMinutes > scheduled + OVER_SCHEDULE_MINUTES,
    noBreak: rawMinutes >= LONG_WORK_MINUTES && breakMinutes <= 0,
  };
}
