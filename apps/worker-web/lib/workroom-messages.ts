import type { SupabaseClient } from '@supabase/supabase-js';

export type WorkroomMessage = {
  id: string; facility_id: string; staff_id: string | null; sender_type: 'admin' | 'worker' | 'system';
  sender_user_id: string | null; sender_name: string; message_type: 'message' | 'announcement' | 'attendance' | 'membership' | 'schedule';
  body: string; metadata: Record<string, unknown>; created_at: string;
};
export type WorkroomScope = { facilityId: string; staffId: string | null; includeGroup: boolean };
const LIMIT = 100;

export async function loadWorkroomPage(client: SupabaseClient, scope: WorkroomScope, cursor?: WorkroomMessage) {
  const query = () => {
    let request = client.from('facility_workroom_messages')
      .select('id,facility_id,staff_id,sender_type,sender_user_id,sender_name,message_type,body,metadata,created_at')
      .eq('facility_id', scope.facilityId);
    request = scope.staffId
      ? scope.includeGroup ? request.or(`staff_id.is.null,staff_id.eq.${scope.staffId}`) : request.eq('staff_id', scope.staffId)
      : request.is('staff_id', null);
    return request.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(LIMIT);
  };
  // Two simple cursor ranges preserve equal-time messages without replacing the
  // staff/group OR filter already applied to the query.
  const results = cursor ? await Promise.all([
    query().lt('created_at', cursor.created_at),
    query().eq('created_at', cursor.created_at).lt('id', cursor.id),
  ]) : [await query()];
  if (results.some(result => result.error)) throw new Error('대화를 불러오지 못했어요. 다시 시도해 주세요.');
  const all = results.flatMap(result => (result.data ?? []) as WorkroomMessage[]);
  const unique = [...new Map(all.map(message => [message.id, message])).values()]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id)).slice(0, LIMIT);
  return { messages: unique.reverse(), hasMore: unique.length === LIMIT };
}
