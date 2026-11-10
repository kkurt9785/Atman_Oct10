// 휴가를 '일'로 읽게 해 주는 표시 규칙.
// DB 는 분 단위로 저장하고 하루를 480분(8시간)으로 친다 — 연차 부여 p_granted_days*480,
// 종일 연차 (종료-시작+1)*480 (20261015020000_atomic_staff_leave_management.sql, 20260723110000_clinic_workforce_lite.sql),
// 관리자 휴가 화면도 minutes/480 이다. 사업장별 설정은 없으므로 여기서도 고정값을 쓴다.
export const LEAVE_DAY_MINUTES = 480;

export const LEAVE_TYPE_LABEL: Record<string, string> = {
  annual: '연차', half_day: '반차', quarter_day: '반반차', hourly: '시간차', sick: '병가', other: '기타',
};

export function leaveTypeLabel(type: string | null | undefined) {
  return LEAVE_TYPE_LABEL[type ?? ''] ?? '휴가';
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
export function leaveRequestLine(row: { leave_type: string; start_date: string; end_date: string; requested_minutes: number }) {
  const period = row.end_date && row.end_date !== row.start_date ? `${row.start_date}~${row.end_date.slice(5)}` : row.start_date;
  return `${leaveTypeLabel(row.leave_type)} · ${period} · ${formatLeaveAmount(row.requested_minutes)}`;
}
