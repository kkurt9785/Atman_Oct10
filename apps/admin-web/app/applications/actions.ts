'use server';
import { revalidatePath } from 'next/cache';
import { adminClient } from '@/lib/supabase';

export async function acceptApplication(
  applicationId: string,
  shiftId: string,
  workerId: string,
) {
  const sb = adminClient();
  if (!sb) return;

  const now = new Date().toISOString();

  await Promise.all([
    sb.from('shift_applications')
      .update({ status: 'accepted', responded_at: now })
      .eq('id', applicationId),
    sb.from('shifts')
      .update({ status: 'matched', matched_worker_id: workerId, matched_at: now })
      .eq('id', shiftId),
  ]);

  // 나머지 지원자 자동 거절
  await sb.from('shift_applications')
    .update({ status: 'rejected', responded_at: now })
    .eq('shift_id', shiftId)
    .neq('id', applicationId)
    .eq('status', 'applied');

  revalidatePath('/applications');
  revalidatePath('/');
}

export async function rejectApplication(applicationId: string) {
  const sb = adminClient();
  if (!sb) return;

  await sb.from('shift_applications')
    .update({ status: 'rejected', responded_at: new Date().toISOString() })
    .eq('id', applicationId);

  revalidatePath('/applications');
  revalidatePath('/');
}
