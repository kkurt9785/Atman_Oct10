// 출퇴근 버튼을 누를 수 있는 시간 — 서버 record_unified_attendance 의 TIME_NOT_ALLOWED 판정을 그대로 옮긴다.
//  · 기준 시각은 facility_staff.default_start_time / default_end_time (근무 건 시간이 아니다 — 서버가 그렇게 판정한다)
//  · 허용 폭은 facility_attendance_settings 의 분 단위 값, 행이 없으면 서버 기본값 60/60/60/120
//  · 근무일은 한국 시간 하루. 밤샘 근무(종료 ≤ 시작)는 종료 시각 전까지 전날 근무로 친다 — 그래서 창이 근무일 밖으로 넘치면 잘린다
export type AttendanceWindowSettings = {
  check_in_before_minutes?: number | null;
  check_in_after_minutes?: number | null;
  check_out_before_minutes?: number | null;
  check_out_after_minutes?: number | null;
};

const DAY = 24 * 60;
const SERVER_DEFAULT = { check_in_before_minutes: 60, check_in_after_minutes: 60, check_out_before_minutes: 60, check_out_after_minutes: 120 } as const;

function minutesOf(time: string | null | undefined) {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!match) return null;
  const hours = Number(match[1]), minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
function setting(settings: AttendanceWindowSettings | null | undefined, key: keyof typeof SERVER_DEFAULT) {
  const value = settings?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : SERVER_DEFAULT[key];
}
function clock(minutes: number) {
  const value = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export type AttendanceWindow = { checkIn: string | null; checkOut: string | null };

export function attendanceWindow(startTime: string | null | undefined, endTime: string | null | undefined, settings?: AttendanceWindowSettings | null): AttendanceWindow | null {
  const start = minutesOf(startTime), end = minutesOf(endTime);
  if (start == null || end == null) return null;
  const overnight = end <= start;
  // 근무일 안의 분(0 = 근무일 00:00). 밤샘이면 [종료, 종료+24h) 구간이 한 근무일이다.
  const dayFrom = overnight ? end : 0, dayTo = dayFrom + DAY - 1;
  const endAt = overnight ? end + DAY : end;
  const range = (from: number, to: number) => {
    const a = Math.max(from, dayFrom), b = Math.min(to, dayTo);
    return a <= b ? `${clock(a)}~${clock(b)}` : null;
  };
  return {
    checkIn: range(start - setting(settings, 'check_in_before_minutes'), start + setting(settings, 'check_in_after_minutes')),
    checkOut: range(endAt - setting(settings, 'check_out_before_minutes'), endAt + setting(settings, 'check_out_after_minutes')),
  };
}

// 오늘 근무 카드 아래 한 줄. 출근 전이면 출근·퇴근 둘 다, 출근 뒤면 퇴근만.
export function attendanceWindowLine(allowed: AttendanceWindow | null, stage: 'check_in' | 'check_out') {
  if (!allowed) return null;
  if (stage === 'check_out') return allowed.checkOut ? `퇴근은 ${allowed.checkOut}에 눌러요` : null;
  if (allowed.checkIn && allowed.checkOut) return `출근은 ${allowed.checkIn} · 퇴근은 ${allowed.checkOut}에 눌러요`;
  if (allowed.checkIn) return `출근은 ${allowed.checkIn}에 눌러요`;
  return null;
}

// 기록이 안 됐을 때 사장님께 보낼 첫 문장 (대화 입력칸에 미리 채운다 — 보내기는 근무자가 직접)
export function attendanceHelpDraft(action: 'check_in' | 'check_out', at: Date) {
  const time = at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
  return `오늘 ${time} ${action === 'check_in' ? '출근' : '퇴근'}했는데 기록이 안 돼요`;
}
