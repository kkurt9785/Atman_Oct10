import type { SupabaseClient } from '@supabase/supabase-js';

// 하단 탭 숫자(2026-11-12 탭 개편). 대화 = 근무자가 보낸 메시지 중 내가 아직 안 읽은 것.
// 1:1 대화(staff_id 있음)는 대화방별 읽은 시각, 전체 공지방(staff_id 없음)은 사업장 읽은 시각과 비교한다.
// 내가 보낸 것·시스템 안내는 세지 않는다.
export type BadgeMessage = { staff_id: string | null; created_at: string; sender_user_id: string | null; sender_type?: string | null };
export type UnreadThreads = { room: number; staff: Record<string, number>; total: number };

/**
 * 대화방별 안 읽은 수. openStaffIds 를 주면 그 사람들의 1:1 대화만 센다 —
 * 근무를 종료했거나 앱 연결이 풀린 사람의 대화는 화면에서 열 수 없어 숫자가 영영 남기 때문이다(11/12 데이터 흐름 QA P1-5).
 */
export function unreadByThread(
  messages: BadgeMessage[],
  threadReads: Array<{ staff_id: string; last_read_at: string }>,
  roomReadAt: string | null,
  adminUserId: string,
  openStaffIds?: Iterable<string> | null,
): UnreadThreads {
  const readAt = new Map(threadReads.map((row) => [row.staff_id, row.last_read_at]));
  const open = openStaffIds ? new Set(openStaffIds) : null;
  const result: UnreadThreads = { room: 0, staff: {}, total: 0 };
  for (const row of messages) {
    if (row.sender_user_id === adminUserId) continue;
    if (row.sender_type && row.sender_type !== 'worker') continue;
    if (row.staff_id && open && !open.has(row.staff_id)) continue;
    const seen = row.staff_id ? readAt.get(row.staff_id) : roomReadAt;
    if (Date.parse(row.created_at) <= Date.parse(seen ?? '1900-01-01T00:00:00Z')) continue;
    if (row.staff_id) result.staff[row.staff_id] = (result.staff[row.staff_id] ?? 0) + 1;
    else result.room += 1;
    result.total += 1;
  }
  return result;
}

export function countUnreadMessages(
  messages: BadgeMessage[],
  threadReads: Array<{ staff_id: string; last_read_at: string }>,
  roomReadAt: string | null,
  adminUserId: string,
  openStaffIds?: Iterable<string> | null,
): number {
  return unreadByThread(messages, threadReads, roomReadAt, adminUserId, openStaffIds).total;
}

/** 숫자 배지 글자. 0이면 빈 문자열(배지를 그리지 않는다), 100 이상은 99+. */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 99 ? '99+' : String(Math.floor(count));
}

/** 대화 화면(사람 칩)과 하단 탭이 같은 숫자를 쓰도록 한곳에서 센다. 실패하면 전부 0. */
export async function loadUnreadWorkroom(sb: SupabaseClient, facilityId: string, adminUserId: string): Promise<UnreadThreads> {
  const none: UnreadThreads = { room: 0, staff: {}, total: 0 };
  const [messages, threadReads, roomRead, staff] = await Promise.all([
    sb.from('facility_workroom_messages').select('staff_id,created_at,sender_user_id,sender_type')
      .eq('facility_id', facilityId).eq('sender_type', 'worker').order('created_at', { ascending: false }).limit(300),
    sb.from('facility_workroom_thread_reads').select('staff_id,last_read_at').eq('facility_id', facilityId).eq('user_id', adminUserId),
    sb.from('facility_workroom_reads').select('last_read_at').eq('facility_id', facilityId).eq('user_id', adminUserId).maybeSingle(),
    sb.from('facility_staff').select('id').eq('facility_id', facilityId).neq('status', 'ended').not('worker_id', 'is', null),
  ]);
  if (messages.error || threadReads.error || roomRead.error || staff.error) return none;
  return unreadByThread(
    (messages.data ?? []) as BadgeMessage[],
    (threadReads.data ?? []) as Array<{ staff_id: string; last_read_at: string }>,
    ((roomRead.data as { last_read_at?: string } | null)?.last_read_at) ?? null,
    adminUserId,
    (staff.data ?? []).map((row) => row.id as string),
  );
}

export async function countUnreadWorkroom(sb: SupabaseClient, facilityId: string, adminUserId: string): Promise<number> {
  return (await loadUnreadWorkroom(sb, facilityId, adminUserId)).total;
}

/** 대화를 읽은 뒤 하단 탭 숫자를 바로 다시 받게 하는 신호(BottomNav 가 듣는다). */
export const NAV_BADGES_EVENT = 'itdot:nav-badges';
