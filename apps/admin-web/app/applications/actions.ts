
'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { nudgeNotificationDispatch } from '@/lib/notify-nudge';
import { userClient } from '@/lib/supabase';

// 프로덕션 빌드는 Server Action에서 throw된 메시지를 마스킹한다.
// 관리자에게 한글 안내가 그대로 닿아야 하므로 결과 객체로 돌려준다.
export type ActionResult = { ok: true } | { ok: false; message: string };

export async function acceptApplication(
  applicationId: string,
  _shiftId?: string,
  _workerId?: string,
  credentialConfirmed = false,
): Promise<ActionResult> {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = userClient(context.accessToken);
  if (!sb) return { ok: false, message: '서버 설정을 확인해 주세요.' };

  if (credentialConfirmed) {
    const { error: confirmError } = await sb.rpc('confirm_application_credential', {
      p_application_id: applicationId,
    });
    if (confirmError) {
      return { ok: false, message: confirmError.message || '자격 확인 기록을 저장하지 못했어요.' };
    }
  }

  const { error } = await sb.rpc('accept_shift_application', {
    p_application_id: applicationId,
  });
  if (error) return { ok: false, message: error.message || '지원 수락에 실패했어요.' };

  await nudgeNotificationDispatch();

  revalidatePath('/applications');
  revalidatePath('/');
  revalidatePath('/shifts');
  return { ok: true };
}

export async function rejectApplication(applicationId: string): Promise<ActionResult> {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = userClient(context.accessToken);
  if (!sb) return { ok: false, message: '서버 설정을 확인해 주세요.' };

  const { data, error } = await sb.rpc('reject_shift_application', {
    p_application_id: applicationId,
  });
  if (error || data !== true) {
    return { ok: false, message: error?.message || '지원 거절에 실패했어요.' };
  }

  revalidatePath('/applications');
  revalidatePath('/');
  return { ok: true };
}
