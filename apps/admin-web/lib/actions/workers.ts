'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '../admin-auth';
import { getPlatformAdminSession } from '../platform-admin';
import { adminClient } from '../supabase';

async function reviewWorker(workerId: string, action: 'approve' | 'reject') {
  // 잇닿 운영자(사업장 없어도 됨) 또는 시설 super. 일반 원장은 다른 시설 워커 서류를 볼 수 없다.
  const platform = await getPlatformAdminSession();
  const context = platform ? null : await requireAdminContext(['super']);
  const actorId = platform?.user.id ?? context?.user.id ?? null;
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');

  const patch = action === 'approve'
    ? {
        verification_status: 'approved',
        verified_at: new Date().toISOString(),
        rejection_reason: null,
      }
    : {
        verification_status: 'rejected',
        verified_at: null,
        rejection_reason: '플랫폼 운영자 심사 반려',
      };

  const { data, error } = await sb
    .from('workers')
    .update(patch)
    .eq('id', workerId)
    .in('verification_status', ['pending', 'reviewing'])
    .eq('is_demo', false)
    .is('deleted_at', null)
    .select('id, verification_status')
    .maybeSingle();

  if (error || !data) throw new Error('심사 가능한 워커를 찾지 못했어요.');

  const { error: auditError } = await sb.from('audit_logs').insert({
    actor_type: 'admin',
    actor_id: actorId,
    action: action === 'approve' ? 'worker.verify.approve' : 'worker.verify.reject',
    entity_type: 'worker',
    entity_id: workerId,
    after_data: { verification_status: data.verification_status },
  });
  if (auditError) console.error('[worker review] audit log failed', auditError);

  revalidatePath('/staff');
}

export async function approveWorkerAction(workerId: string) {
  await reviewWorker(workerId, 'approve');
}

export async function rejectWorkerAction(workerId: string) {
  await reviewWorker(workerId, 'reject');
}
