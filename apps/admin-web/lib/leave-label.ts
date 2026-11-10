// 휴가 종류를 화면 글자로. 반차는 오전·오후(staff_leave_requests.half_day_period)를 붙여 '오전 반차'로 읽는다.
// 근무자 앱 lib/leave-display.ts 와 같은 규칙이다 — 두 앱이 lib 을 나눠 쓰지 않아 여기에도 둔다.
export const LEAVE_TYPE_LABEL: Record<string, string> = { annual: '연차', half_day: '반차', quarter_day: '반반차', hourly: '시간차', sick: '병가', other: '기타' };
export const HALF_DAY_PERIOD_LABEL: Record<string, string> = { am: '오전', pm: '오후' };

/** 화면 선택값 'half_day:am' → { type: 'half_day', period: 'am' }. 반차가 아니거나 시간대가 없으면 period 는 null */
export function splitLeaveChoice(choice: string | null | undefined): { type: string; period: 'am' | 'pm' | null } {
  const [type = '', period = ''] = String(choice ?? '').split(':');
  return { type, period: type === 'half_day' && (period === 'am' || period === 'pm') ? period : null };
}

/** '반차' + 'am' → '오전 반차'. other 는 문장에 넣을 때 '기타 휴가'처럼 바꿔 쓸 수 있다 */
export function leaveTypeLabel(type: string | null | undefined, period?: string | null, otherLabel = '기타'): string {
  const key = String(type ?? '');
  const base = key === 'other' ? otherLabel : LEAVE_TYPE_LABEL[key] ?? '휴가';
  const half = key === 'half_day' ? HALF_DAY_PERIOD_LABEL[period ?? ''] : undefined;
  return half ? `${half} ${base}` : base;
}
