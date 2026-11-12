import type { SupabaseClient } from '@supabase/supabase-js';

// 하단 탭 숫자(2026-11-12 탭 개편). 대화 = 근무자가 보낸 메시지 중 내가 아직 안 읽은 것.
// 1:1 대화(staff_id 있음)는 대화방별 읽은 시각, 전체 공지방(staff_id 없음)은 사업장 읽은 시각과 비교한다.
// 내가 보낸 것·시스템 안내는 세지 않는다.
export type BadgeMessage = { staff_id: string | null; created_at: string; sender_user_id: string | null; sender_type?: string | null };

export function countUnreadMessages(
  messages: BadgeMessage[],
  threadReads: Array<{ staff_id: string; last_read_at: string }>,
  roomReadAt: string | null,
  adminUserId: string,
): number {
  const readAt = new Map(threadReads.map((row) => [row.staff_id, row.last_read_at]));
  let count = 0;
  for (const row of messages) {
    if (row.sender_user_id === adminUserId) continue;
    if (row.sender_type && row.sender_type !== 'worker') continue;
    const seen = row.staff_id ? readAt.get(row.staff_id) : roomReadAt;
    if (Date.parse(row.created_at) <= Date.parse(seen ?? '1900-01-01T00:00:00Z')) continue;
    count += 1;
  }
  return count;
}

/** 숫자 배지 글자. 0이면 빈 문자열(배지를 그리지 않는다), 100 이상은 99+. */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 99 ? '99+' : String(Math.floor(count));
}

export async function countUnreadWorkroom(sb: SupabaseClient, facilityId: string, adminUserId: string): Promise<number> {
  const [messages, threadReads, roomRead] = await Promise.all([
    sb.from('facility_workroom_messages').select('staff_id,created_at,sender_user_id,sender_type')
      .eq('facility_id', facilityId).eq('sender_type', 'worker').order('created_at', { ascending: false }).limit(300),
    sb.from('facility_workroom_thread_reads').select('staff_id,last_read_at').eq('facility_id', facilityId).eq('user_id', adminUserId),
    sb.from('facility_workroom_reads').select('last_read_at').eq('facility_id', facilityId).eq('user_id', adminUserId).maybeSingle(),
  ]);
  if (messages.error || threadReads.error || roomRead.error) return 0;
  return countUnreadMessages(
    (messages.data ?? []) as BadgeMessage[],
    (threadReads.data ?? []) as Array<{ staff_id: string; last_read_at: string }>,
    ((roomRead.data as { last_read_at?: string } | null)?.last_read_at) ?? null,
    adminUserId,
  );
}
