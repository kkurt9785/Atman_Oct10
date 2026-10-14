'use server';

import { adminClient } from '@/lib/supabase';
import { getCurrentFacilityId } from '@/lib/facility';

export type ChatHeader = { workerName: string; shiftDate: string; startTime: string };

// 채팅 상단에 '누구와, 언제 근무' 인지 보여 주기 위한 읽기 전용 조회.
// 지금 로그인한 관리자의 사업장 공고에 달린 지원만 돌려준다(목록 화면 getChatRows와 같은 범위).
export async function getChatHeader(applicationId: string): Promise<ChatHeader | null> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId || !applicationId) return null;

  const { data } = await sb
    .from('shift_applications')
    .select('id, workers ( name ), shifts!inner ( facility_id, shift_date, start_time )')
    .eq('id', applicationId)
    .eq('shifts.facility_id', facilityId)
    .maybeSingle();
  if (!data) return null;

  const worker = data.workers as unknown as { name: string } | null;
  const shift = data.shifts as unknown as { shift_date: string; start_time: string } | null;
  return {
    workerName: worker?.name ?? '근무자',
    shiftDate: shift?.shift_date ?? '',
    startTime: shift?.start_time?.slice(0, 5) ?? '',
  };
}
