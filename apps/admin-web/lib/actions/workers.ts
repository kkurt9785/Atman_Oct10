'use server';

import { revalidatePath } from 'next/cache';
import { adminClient } from '../supabase';
import { requireFacilityAdmin } from '../facility';

export async function approveWorkerAction(workerId: string) {
  const sb = adminClient();
  if (!sb) throw new Error('인증 필요');
  // 서명된 시설 쿠키가 있어야 함(set-facility 에서 소유권 검증 후 발급) = 인증된 관리자
  if (!(await requireFacilityAdmin())) throw new Error('관리자 인증이 필요합니다.');

  const { data, error } = await sb
    .from('workers')
    .update({ verification_status: 'approved', verified_at: new Date().toISOString() })
    .eq('id', workerId)
    .in('verification_status', ['pending', 'reviewing'])
    .eq('is_demo', false)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) throw new Error('승인할 수 없는 워커입니다.');

  revalidatePath('/staff');
}

export async function rejectWorkerAction(workerId: string) {
  const sb = adminClient();
  if (!sb) throw new Error('인증 필요');
  if (!(await requireFacilityAdmin())) throw new Error('관리자 인증이 필요합니다.');

  const { data, error } = await sb
    .from('workers')
    .update({ verification_status: 'rejected', rejection_reason: '관리자 심사 반려' })
    .eq('id', workerId)
    .in('verification_status', ['pending', 'reviewing'])
    .eq('is_demo', false)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) throw new Error('거절할 수 없는 워커입니다.');

  revalidatePath('/staff');
}
