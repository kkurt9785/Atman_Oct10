// 근태·급여 CSV에 들어가는 글자를 만든다. 원장이 엑셀로 바로 읽는 파일이라 시각은 한국 시간, 상태·인증 방식은 화면과 같은 한글로 쓴다.
// 2026-11-10 치과원장 QA: 출퇴근 시각이 UTC 원문이라 9시간 어긋났고 상태가 completed/late 같은 영어였다.
import type { AttendanceHistoryRow } from './db/attendance-history';

export const ATTENDANCE_STATUS_LABEL: Record<string, string> = { scheduled: '예정', working: '근무 중', checkout_pending: '승인 대기', completed: '완료', late: '지각', absent: '결근', leave: '휴가', off: '휴무' };
export const ATTENDANCE_METHOD_LABEL: Record<string, string> = { GPS: '위치', GPS_QR: '위치+QR', QR: 'QR', QR_FALLBACK: 'QR 보완', WORKPLACE_NET: '사업장 네트워크', ADMIN: '관리자', qr: '기존 QR', button: '원터치' };

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const KST_OFFSET = 9 * 60 * 60 * 1000;

export function weekdayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return Number.isNaN(day) ? '' : WEEKDAY[day];
}

// 한국 시간 HH:mm. 근무일과 날짜가 다르면(야간 근무 퇴근 등) 날짜를 앞에 붙인다
export function kstClock(iso: string | null | undefined, workDate?: string | null): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const local = new Date(time + KST_OFFSET).toISOString();
  const date = local.slice(0, 10), clock = local.slice(11, 16);
  if (!workDate || date === workDate) return clock;
  const next = new Date(Date.parse(`${workDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return date === next ? `다음날 ${clock}` : `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))} ${clock}`;
}

export function kstDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  return Number.isFinite(time) ? new Date(time + KST_OFFSET).toISOString().slice(0, 10) : '';
}

export function minutesText(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60), rest = total % 60;
  return hours === 0 ? `${rest}분` : rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

export const ATTENDANCE_EXPORT_HEADER = ['근무일', '요일', '이름', '구분', '상태', '예정 출근', '예정 퇴근', '실제 출근', '실제 퇴근', '휴게(분)', '인정 근무시간', '인정 근무(분)', '지각(분)', '조퇴(분)', '인증 방식', '수정 사유', '시간 기준'];

export function attendanceExportRow(r: AttendanceHistoryRow): Array<string | number> {
  const pending = Boolean(r.recognitionPending);
  return [
    r.workDate, weekdayOf(r.workDate), r.name, r.kind === 'staff' ? '직원' : '공고 근무',
    ATTENDANCE_STATUS_LABEL[r.status] ?? r.status,
    r.scheduledStart?.slice(0, 5) ?? '', r.scheduledEnd?.slice(0, 5) ?? '',
    kstClock(r.checkInAt, r.workDate), kstClock(r.checkOutAt, r.workDate),
    pending ? '' : r.breakMinutes, pending ? '' : minutesText(r.workedMinutes), pending ? '' : r.workedMinutes,
    r.lateMinutes, r.earlyLeaveMinutes,
    r.method ? ATTENDANCE_METHOD_LABEL[r.method] ?? r.method : '', r.correctionReason ?? '',
    pending ? '정산 전 · 인정시간 미확정' : r.kind === 'shift' ? '저장된 급여 정산 기준' : '근태 기록 기준',
  ];
}

// 엑셀에서 1일부터 읽히게 날짜 오름차순 → 이름순
export function attendanceExportRows(rows: AttendanceHistoryRow[]): Array<Array<string | number>> {
  return [...rows].sort((a, b) => a.workDate.localeCompare(b.workDate) || a.name.localeCompare(b.name, 'ko')).map(attendanceExportRow);
}

export type StaffMonthStats = { attendDays: number; lateCount: number; earlyLeaveCount: number; absentDays: number };

// 급여 CSV에 붙이는 직원별 한 달 근태 요약(출근일수·지각·조퇴·결근). 공고 근무 기록은 세지 않는다
export function staffMonthStats(rows: AttendanceHistoryRow[]): Map<string, StaffMonthStats> {
  const map = new Map<string, StaffMonthStats>();
  for (const r of rows) {
    if (r.kind !== 'staff' || !r.staffId) continue;
    const stats = map.get(r.staffId) ?? { attendDays: 0, lateCount: 0, earlyLeaveCount: 0, absentDays: 0 };
    if (r.checkInAt) stats.attendDays += 1;
    if (r.lateMinutes > 0 || r.status === 'late') stats.lateCount += 1;
    if (r.earlyLeaveMinutes > 0) stats.earlyLeaveCount += 1;
    if (r.status === 'absent') stats.absentDays += 1;
    map.set(r.staffId, stats);
  }
  return map;
}
