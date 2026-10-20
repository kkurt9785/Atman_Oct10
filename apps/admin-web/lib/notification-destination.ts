import { safeNotificationPath } from './shared/notifications/navigation';

// Always switch the authorized facility before opening facility-scoped content.
export function adminNotificationDestination(data: Record<string, unknown> | null): string {
  const next = safeFacilityDestination(data?.url);
  const facility = data?.facilityId ?? data?.facility_id;
  if (typeof facility !== 'string' || !facility) return next;
  return `/notifications/open?${new URLSearchParams({ facility, next })}`;
}

export function safeFacilityDestination(value: unknown): string {
  const path = safeNotificationPath(value);
  // Do not allow side-effect endpoints or recursive handoffs as destinations.
  return path && (path==='/' || /^\/(timesheet|gig-pay|operations|staff|workroom|applications|chats|shifts|payroll|sites|attendance-history|attendance-summary|membership|notifications)(\/|\?|#|$)/.test(path))
    && !/^\/notifications\/open(\/|\?|#|$)/.test(path) ? path : '/';
}
