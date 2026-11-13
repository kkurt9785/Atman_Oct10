// 홈 '오늘 근무 N명'·근태 '오늘 근무자' 탭·운영 '확인할 일'이 같은 숫자를 내도록 세는 기준을 한곳에 둔다.
// 2026-11-05 QA: 홈은 휴가 제외·사람 기준, 근태 탭은 휴가 포함·기록 기준이라 4 vs 5로 어긋났다.
// 오늘 근무 기준: 휴가자 제외 · 확인 필요(결근·조기 퇴근 승인 대기) 포함 · 같은 사람의 여러 기록(직원 근태 + 공고 근무, 공고 2건)은 1명.
export type HeadcountStaff = { id: string; workerId: string | null; scheduledToday: boolean; attendanceStatus: string | null };
// 오늘 확정된 공고 근무 한 건. id 는 근무자(workers.id) — 직원의 workerId 와 같은 값이라 같은 사람을 묶을 수 있다.
export type HeadcountShift = { id: string };

// 근무 일정이 있거나, 일정이 없어도 오늘 기록(출근·휴가 등)이 생긴 직원만 오늘 근태 대상이다
export function isTodayStaffRecord(row: Pick<HeadcountStaff, 'scheduledToday' | 'attendanceStatus'>): boolean {
  return row.scheduledToday || row.attendanceStatus !== 'off';
}

export function todayHeadcount(staff: HeadcountStaff[], shifts: HeadcountShift[]): { working: number; onLeave: number } {
  const working = new Set<string>();
  const onLeave = new Set<string>();
  for (const row of staff) {
    if (!isTodayStaffRecord(row)) continue;
    const person = row.workerId ? `worker:${row.workerId}` : `staff:${row.id}`;
    (row.attendanceStatus === 'leave' ? onLeave : working).add(person);
  }
  for (const shift of shifts) working.add(`worker:${shift.id}`);
  // 휴가 중이어도 오늘 공고 근무를 하면 근무자로 센다
  for (const person of working) onLeave.delete(person);
  return { working: working.size, onLeave: onLeave.size };
}

// 홈 '출퇴근 확인'과 운영 '확인할 일'의 출퇴근 몫. 미출근(no_show 알림)·조기 퇴근 승인 대기·인증 실패·퇴근 누락을 더한다.
// 퇴근 누락은 날짜와 상관없이 아직 정리 안 된 전체 건수다(오늘 화면 밖의 지난 기록도 포함, D2).
export function attendanceReviewCount(staff: Array<Pick<HeadcountStaff, 'attendanceStatus'>>, noShowCount: number, failureCount: number, missingCheckoutCount = 0): number {
  return staff.filter((row) => row.attendanceStatus === 'checkout_pending').length + noShowCount + failureCount + missingCheckoutCount;
}
