type Shift = { id: string; status: string; checked_in_at: string | null; checked_out_at: string | null; shifts: { shift_date: string; start_time: string; facilities: { id: string } | { id: string }[] } | { shift_date: string; start_time: string; facilities: { id: string } | { id: string }[] }[] };
export function selectWorkplaceStaff<T extends {id:string;facilities:{id:string}|{id:string}[]}>(rows:T[],facilityId?:string|null,staffId?:string|null):T|null {
  const matching=rows.filter(row=>!facilityId||(Array.isArray(row.facilities)?row.facilities[0]:row.facilities)?.id===facilityId);
  return staffId ? matching.find(row=>row.id===staffId)??null : matching[0]??null;
}
export function selectWorkplaceShift<T extends Shift>(rows: T[], today: string, facilityId?: string | null, applicationId?: string | null): T | null {
  const shiftOf = (row: T) => Array.isArray(row.shifts) ? row.shifts[0] : row.shifts;
  const list = rows.filter(row => { const facilities = shiftOf(row).facilities; return !facilityId || (Array.isArray(facilities) ? facilities[0] : facilities)?.id === facilityId; }).sort((a,b) => `${shiftOf(a).shift_date} ${shiftOf(a).start_time}`.localeCompare(`${shiftOf(b).shift_date} ${shiftOf(b).start_time}`));
  if (applicationId) return list.find(row => row.id === applicationId) ?? null;
  return list.find(row => row.status === 'accepted' && row.checked_in_at && !row.checked_out_at)
    ?? list.find(row => row.status === 'accepted' && !row.checked_out_at && shiftOf(row).shift_date === today)
    ?? list.find(row => row.status === 'completed' && shiftOf(row).shift_date === today) ?? null;
}
export function currentStaffAttendance<T extends { staff_id: string; check_in_at: string | null; check_out_at: string | null; work_date: string }>(monthly: T[], open: T[], today: string) {
  const result: Record<string,T> = {};
  for (const row of open) if (row.check_in_at && !row.check_out_at && !result[row.staff_id]) result[row.staff_id] = row;
  for (const row of monthly) if (row.work_date === today && !result[row.staff_id]) result[row.staff_id] = row;
  return result;
}
export function staffAttendanceLabel(row?: { check_in_at: string | null; check_out_at: string | null; status?: string } | null) {
  return row?.check_out_at ? '퇴근 완료' : row?.status === 'checkout_pending' ? '퇴근 승인 대기' : row?.check_in_at ? '현재 근무 중' : '출근 전';
}
export function attendancePolicyHelp(mode: string) {
  if (mode === 'admin') return '관리자가 실제 근무를 확인하고 출퇴근을 기록하는 현장이에요.';
  if (mode === 'gps_qr') return '위치와 현장 동적 QR을 모두 확인해요. 위치 확인이 어렵다면 관리자에게 문의해 주세요.';
  if (mode === 'network') return '현장에 등록된 네트워크에서 인증해요. 연결이 어렵다면 관리자에게 문의해 주세요.';
  if (mode === 'qr') return '현장의 동적 QR을 스캔하고 출퇴근 버튼을 눌러 주세요.';
  return '출퇴근할 때 현장 인증 정책을 확인해요. 인증이 어렵다면 화면의 안내를 따라 주세요.';
}
const factTime = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
// 지금 상태를 사실 한 줄로 — '현재 근무 중' 같은 상태 이름보다 '07:09 출근 · 근무 중'이 바로 읽힌다(2026-11-10 근태 화면 정리)
export function staffAttendanceFact(row?: { check_in_at: string | null; check_out_at: string | null; status?: string } | null) {
  if (row?.check_in_at && row.check_out_at) return `${factTime(row.check_in_at)} 출근 → ${factTime(row.check_out_at)} 퇴근`;
  if (row?.check_out_at) return `${factTime(row.check_out_at)} 퇴근`;
  if (row?.check_in_at) return `${factTime(row.check_in_at)} 출근 · ${row.status === 'checkout_pending' ? '퇴근 승인 대기' : '근무 중'}`;
  if (row?.status === 'leave') return '오늘은 휴가예요';
  return '아직 출근 전이에요';
}
// 기본 방식(위치·간편 인증)은 누르면 알아서 확인하니 설명이 필요 없다. 다르게 해야 하는 현장만 한 줄로 알린다.
export function attendancePolicyNote(mode: string) {
  return ['admin', 'gps_qr', 'network', 'qr'].includes(mode) ? attendancePolicyHelp(mode) : null;
}
