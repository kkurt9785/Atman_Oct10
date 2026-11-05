import { noticeHref, type Notice } from './notification-scope';
import type { WorkerShell } from './worker-mode';

// 알림을 눌렀을 때 열 화면. data.url 이 있으면 그 주소(긱 셸은 같은 화면의 /gig 경로), 없으면 알림 종류로 정한다.
// 새 공고·수락·채팅 알림은 주소 없이 {type, shiftId}·{type, applicationId}만 실어 와서 눌러도 그대로였다(2026-11-05 QA).
// 푸시 클릭(public/sw.js)과 같은 방향: 채팅 → 그 채팅방, 수락 → 내 근무, 새 공고 → 근무 찾기(그 공고 시트를 연다).
function field(data: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) { const value = data[key]; if (typeof value === 'string' && value) return value; }
  return null;
}

function byKind(notice: Pick<Notice, 'event_type' | 'data'>): string | null {
  const data = notice.data ?? {};
  const type = field(data, 'type') ?? '';
  const event = notice.event_type ?? '';
  const kind = field(data, 'kind') ?? event;
  const shiftId = field(data, 'shiftId', 'shift_id');
  const applicationId = field(data, 'applicationId', 'application_id');
  const myApplication = applicationId ? `/applications#application-${encodeURIComponent(applicationId)}` : '/applications';
  if (type === 'chat' || event === 'chat.message') return applicationId ? `/chat/${encodeURIComponent(applicationId)}` : '/applications';
  // 반복근무 요청은 data.type 이 새 공고와 같은 new_shift 지만 수락은 '내 근무'에서 한다
  if (event === 'shift.invited') return myApplication;
  if (type === 'new_shift' || type === 'urgent_shift' || event === 'shift.created' || event === 'shift.urgent') return shiftId ? `/shifts?highlight=${encodeURIComponent(shiftId)}` : '/shifts';
  if (type === 'new_shift_batch') return '/shifts';
  // 동료의 대타 요청·맡기 거절·요청 취소는 대타 목록에서, 내가 맡은 대타의 확정은 내 근무에서 본다
  if (['shift.cover_requested', 'shift.cover_claim_rejected', 'shift.cover_cancelled'].includes(event)) return '/cover';
  if (type === 'accepted' || type === 'vacancy_invited' || type === 'checkout' || event.startsWith('shift.') || event.startsWith('shift_application.') || event.startsWith('credential.')) return myApplication;
  if (kind.startsWith('attendance.')) return '/workplace';
  return null;
}

export function noticeDestination(notice: Pick<Notice, 'event_type' | 'data'>, shell: WorkerShell): string | null {
  const explicit = noticeHref(notice.data?.url, shell);
  const fallback = byKind(notice);
  // 목록 주소만 적힌 알림(/shifts, /applications)은 같은 목록 안에서 그 공고·지원을 바로 연다
  if (explicit && fallback && (explicit === '/shifts' || explicit === '/applications') && fallback.startsWith(explicit)) return fallback;
  if (explicit) return explicit;
  return fallback ? noticeHref(fallback, shell) : null;
}
