
'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { userClient } from '@/lib/supabase';

export async function acceptApplication(
  applicationId: string,
  _shiftId?: string,
  _workerId?: string,
) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = userClient(context.accessToken);
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');

  const { error } = await sb.rpc('accept_shift_application', {
    p_application_id: applicationId,
  });
  if (error) throw new Error(error.message || '지원 수락에 실패했어요.');

  revalidatePath('/applications');
  revalidatePath('/');
  revalidatePath('/shifts');
}

export async function rejectApplication(applicationId: string) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = userClient(context.accessToken);
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');

  const { data, error } = await sb.rpc('reject_shift_application', {
    p_application_id: applicationId,
  });
  if (error || data !== true) {
    throw new Error(error?.message || '지원 거절에 실패했어요.');
  }

  revalidatePath('/applications');
  revalidatePath('/');
}
