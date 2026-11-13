// 퇴근 누락(미퇴근) 조치 목록 — 조회와 무관한 계산만 둔다(시험: worker-web/lib/__tests__/admin-missing-checkouts.test.ts).
// 시스템이 매시간 '퇴근 가능 시간이 지났는데 퇴근 기록이 없는' 근태에 missing_checkout_at 을 찍는다
// (supabase/migrations/20261113100000, docs/attendance/DECISIONS.md D1·D2). 관리자가 퇴근시간을 넣으면 목록에서 빠진다.

export type MissingCheckout = {
  id: string;
  kind: 'staff' | 'shift';
  name: string;
  workDate: string; // YYYY-MM-DD (KST 근무일)
  checkInAt: string;
  scheduledEnd: string | null; // HH:MM:SS
  flaggedAt: string;
};

// 오래된 것부터 — 오래 둘수록 급여·마감이 늦어진다. 같은 날이면 먼저 출근한 순.
export function sortMissingCheckouts(rows: MissingCheckout[]): MissingCheckout[] {
  return [...rows].sort((a, b) => a.workDate.localeCompare(b.workDate) || a.checkInAt.localeCompare(b.checkInAt));
}

export const MISSING_CHECKOUT_LIST_LIMIT = 50;

// 화면에는 오래된 50건, 숫자는 전체 건수 — 50건을 넘으면 근태 기록에서 월별로 마저 정리한다
export function takeOldest(rows: MissingCheckout[], limit = MISSING_CHECKOUT_LIST_LIMIT): MissingCheckout[] {
  return sortMissingCheckouts(rows).slice(0, limit);
}

// 정리 화면 = 그 근무일이 속한 달의 근태 기록, 해당 기록 위치로
export function missingCheckoutHref(row: Pick<MissingCheckout, 'id' | 'kind' | 'workDate'>): string {
  return `/attendance-history?month=${row.workDate.slice(0, 7)}#att-${row.kind}-${row.id}`;
}
