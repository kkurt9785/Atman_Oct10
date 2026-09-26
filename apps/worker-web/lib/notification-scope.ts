import type { WorkerShell, WorkerShellContext } from '@/lib/worker-mode';

// 알림함은 계정 단위(get_my_notifications)라 긱 근무지 알림과 병원·약국 알림이 한 줄로 섞여 온다.
// 어느 셸의 알림인지는 payload 의 근무지 단서(staff_id / facilityId)로 가른다.

export type Notice = {
  id: string;
  event_type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
};

export type NoticeScope = WorkerShell | 'both';

type ScopeContext = Pick<WorkerShellContext, 'gigStaffIds' | 'gigFacilityIds' | 'hasGig' | 'hasMedical'>;

function stringField(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

export function classifyNotice(notice: Notice, context: ScopeContext): NoticeScope {
  const data = notice.data ?? {};
  const kind = stringField(data, 'kind') ?? notice.event_type ?? '';
  const attendanceLike = kind.startsWith('attendance.') || kind.startsWith('workroom.');
  // 공고·지원·채팅·급여·자격 알림은 의료 워커 셸에만 있다
  if (!attendanceLike) return 'medical';

  const staffId = stringField(data, 'staff_id', 'staffId');
  if (staffId) return context.gigStaffIds.includes(staffId) ? 'gig' : 'medical';
  const facilityId = stringField(data, 'facilityId', 'facility_id');
  if (facilityId) return context.gigFacilityIds.includes(facilityId) ? 'gig' : 'medical';
  // 단기 시프트(shift_applications) 근태는 의료 워커 셸 전용
  if (stringField(data, 'application_id', 'applicationId')) return 'medical';

  // 근무지를 특정할 수 없는 근태 알림: 한쪽만 쓰면 그쪽, 둘 다 쓰면 양쪽에서 보여 준다 (알림을 잃는 것보다 낫다)
  if (context.hasGig && !context.hasMedical) return 'gig';
  if (!context.hasGig) return 'medical';
  return 'both';
}

export function noticeBelongsTo(scope: NoticeScope, shell: WorkerShell) {
  return scope === 'both' || scope === shell;
}

// DB 함수는 알림 URL 을 의료 셸 기준(/workplace, /workroom)으로 적는다. 긱 셸에서는 같은 화면의 /gig 경로로 연다.
export function noticeHref(url: unknown, shell: WorkerShell) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return null;
  if (shell === 'medical') return url;
  if (url === '/workroom' || url.startsWith('/workroom?')) return url.replace('/workroom', '/gig/workroom');
  if (url === '/workplace' || url.startsWith('/workplace?')) return url.replace('/workplace', '/gig');
  return url;
}
