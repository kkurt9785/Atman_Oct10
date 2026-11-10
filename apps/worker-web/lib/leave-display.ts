// 휴가를 '일'로 읽게 해 주는 표시 규칙.
// DB 는 분 단위로 저장하고 하루를 480분(8시간)으로 친다 — 연차 부여 p_granted_days*480,
// 종일 연차 (종료-시작+1)*480 (20261015020000_atomic_staff_leave_management.sql, 20260723110000_clinic_workforce_lite.sql),
// 관리자 휴가 화면도 minutes/480 이다. 사업장별 설정은 없으므로 여기서도 고정값을 쓴다.
export const LEAVE_DAY_MINUTES = 480;

export const LEAVE_TYPE_LABEL: Record<string, string> = {
  annual: '연차', half_day: '반차', quarter_day: '반반차', hourly: '시간차', sick: '병가', other: '기타',
};

// 반차 시간대(staff_leave_requests.half_day_period). 화면 선택값은 'half_day:am' 처럼 종류에 붙여 한 칸으로 고른다.
export const HALF_DAY_PERIOD_LABEL: Record<string, string> = { am: '오전', pm: '오후' };

/** 선택값 'half_day:am' → { type: 'half_day', period: 'am' }. 반차가 아니거나 시간대가 없으면 period 는 null */
export function splitLeaveChoice(choice: string | null | undefined): { type: string; period: 'am' | 'pm' | null } {
  const [type = '', period = ''] = String(choice ?? '').split(':');
  return { type, period: type === 'half_day' && (period === 'am' || period === 'pm') ? period : null };
}

/** '반차' + 'am' → '오전 반차'. 종류 자리에 'half_day:pm' 을 넣어도 된다 */
export function leaveTypeLabel(type: string | null | undefined, period?: string | null) {
  const choice = splitLeaveChoice(type);
  const base = LEAVE_TYPE_LABEL[choice.type] ?? '휴가';
  const half = choice.type === 'half_day' ? HALF_DAY_PERIOD_LABEL[period ?? choice.period ?? ''] : undefined;
  return half ? `${half} ${base}` : base;
}

const number = (value: number, digits: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: digits });

/** 120시간 → '15일 (120시간)', 반차 → '0.5일 (4시간)'. 반반차(2시간) 단위로 안 떨어지면 '14일 1시간 (113시간)', 하루 미만이면 시간만 */
export function formatLeaveAmount(minutes: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = `${number(total / 60, 1)}시간`;
  if (total % (LEAVE_DAY_MINUTES / 4) === 0) return `${number(total / LEAVE_DAY_MINUTES, 2)}일 (${hours})`;
  const days = Math.floor(total / LEAVE_DAY_MINUTES);
  if (days === 0) return hours;
  return `${days}일 ${number((total - days * LEAVE_DAY_MINUTES) / 60, 1)}시간 (${hours})`;
}

/** 신청 한 줄: '연차 · 2026-11-11~11-12 · 2일 (16시간)' */
export function leaveRequestLine(row: { leave_type: string; start_date: string; end_date: string; requested_minutes: number; half_day_period?: string | null }) {
  const period = row.end_date && row.end_date !== row.start_date ? `${row.start_date}~${row.end_date.slice(5)}` : row.start_date;
  return `${leaveTypeLabel(row.leave_type, row.half_day_period)} · ${period} · ${formatLeaveAmount(row.requested_minutes)}`;
}
