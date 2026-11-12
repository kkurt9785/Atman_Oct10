import { safeNotificationPath } from './shared/notifications/navigation';

// Always switch the authorized facility before opening facility-scoped content.
export function adminNotificationDestination(data: Record<string, unknown> | null): string {
  const next = safeFacilityDestination(data?.url);
  const facility = data?.facilityId ?? data?.facility_id;
  // 등록 반려 알림(/setup/…)은 이미 지워진 사업장을 가리킨다 — 사업장 전환을 거치면 권한 오류 화면이 뜬다
  if (typeof facility !== 'string' || !facility || /^\/(setup|ops)(\/|\?|#|$)/.test(next)) return next;
  return `/notifications/open?${new URLSearchParams({ facility, next })}`;
}

// 알림 목록은 지금 사업장 것만 — data.facilityId(또는 facility_id)가 다른 사업장이면 뺀다. 사업장 정보가 없는 알림은 그대로 둔다
export function noticeInFacility(data: Record<string, unknown> | null, facilityId: string | null): boolean {
  const facility = data?.facilityId ?? data?.facility_id;
  return !facilityId || typeof facility !== 'string' || !facility || facility === facilityId;
}

export function safeFacilityDestination(value: unknown): string {
  const path = safeNotificationPath(value);
  // Do not allow side-effect endpoints or recursive handoffs as destinations.
  return path && (path==='/' || /^\/(timesheet|leave|gig-pay|gig-work|operations|staff|workroom|applications|chats|shifts|payroll|sites|attendance-history|attendance-summary|membership|notifications|more|setup|ops)(\/|\?|#|$)/.test(path))
    && !/^\/notifications\/open(\/|\?|#|$)/.test(path) ? path : '/';
}
