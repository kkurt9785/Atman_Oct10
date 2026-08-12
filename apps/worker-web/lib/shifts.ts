import { supabase } from './supabase';

export type ApplyFailureReason = 'auth' | 'worker' | 'duplicate' | 'unavailable' | 'error';

export type ApplyShiftResult =
  | { ok: true; applicationId: string }
  | { ok: false; message: string; reason?: ApplyFailureReason };

function classify(message: string): ApplyFailureReason {
  if (/로그인/.test(message)) return 'auth';
  if (/심사|워커/.test(message)) return 'worker';
  if (/이미 지원/.test(message)) return 'duplicate';
  if (/지원할 수 없|자격|지난|시간대/.test(message)) return 'unavailable';
  return 'error';
}

// 지원 트리거가 관리자 알림을 인큐하므로, 즉시 발송되도록 디스패처를 깨운다 (fire-and-forget)
async function nudgeAdminDispatch(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const adminBase = process.env.NEXT_PUBLIC_ADMIN_WEB_URL
    ?? (window.location.hostname === 'localhost' ? 'http://localhost:3002' : 'https://admin.itdot.co.kr');
  fetch(`${adminBase}/api/attendance/nudge`, {
    method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` }, keepalive: true,
  }).catch(() => undefined);
}

export async function applyToShift(shiftId: string): Promise<ApplyShiftResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'auth', message: '로그인이 필요해요.' };

  const { data, error } = await supabase.rpc('apply_to_shift', { p_shift_id: shiftId });
  if (error || typeof data !== 'string') {
    const message = error?.message?.replace(/^.*?: /, '') ?? '지원 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.';
    return { ok: false, reason: classify(message), message };
  }
  void nudgeAdminDispatch();
  return { ok: true, applicationId: data };
}

export async function cancelApplication(applicationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancel_my_shift_application', {
    p_application_id: applicationId,
  });
  return !error && data === true;
}

export async function respondToInvitation(applicationId: string, accept: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('respond_to_shift_invitation', {
    p_application_id: applicationId,
    p_accept: accept,
  });
  return !error && data === true;
}
