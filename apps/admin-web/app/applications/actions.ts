
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
  credentialVerificationMethod = 'internal_hr_process',
): Promise<ActionResult> {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = userClient(context.accessToken);
  if (!sb) return { ok: false, message: '서버 설정을 확인해 주세요.' };

  if (credentialConfirmed) {
    const { error: confirmError } = await sb.rpc('confirm_application_credential', {
      p_application_id: applicationId,
      p_verification_method: credentialVerificationMethod,
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

// ── 근무 대타 요청 ────────────────────────────────────────────────
// 승인: 원래 워커의 확정을 내리고 맡겠다고 한 사람을 확정한다(한 트랜잭션, DB가 권한·자격 검사).
export async function approveCover(requestId: string): Promise<ActionResult> {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = userClient(context.accessToken);
  if (!sb) return { ok: false, message: '서버 설정을 확인해 주세요.' };
  const { error } = await sb.rpc('approve_shift_cover', { p_request_id: requestId });
  if (error) return { ok: false, message: error.message || '대타를 승인하지 못했어요.' };
  await nudgeNotificationDispatch();
  revalidatePath('/applications');
  revalidatePath('/operations');
  revalidatePath('/shifts');
  revalidatePath('/');
  return { ok: true };
}

// 이 사람은 아님: 요청은 다시 열려 다른 사람이 맡을 수 있다. 원래 워커의 근무는 그대로다.
export async function rejectCoverClaim(requestId: string): Promise<ActionResult> {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = userClient(context.accessToken);
  if (!sb) return { ok: false, message: '서버 설정을 확인해 주세요.' };
  const { error } = await sb.rpc('reject_shift_cover_claim', { p_request_id: requestId });
  if (error) return { ok: false, message: error.message || '처리하지 못했어요.' };
  await nudgeNotificationDispatch();
  revalidatePath('/applications');
  revalidatePath('/operations');
  return { ok: true };
}
