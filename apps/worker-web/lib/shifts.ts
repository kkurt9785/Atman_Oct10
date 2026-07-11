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

export async function applyToShift(shiftId: string): Promise<ApplyShiftResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'auth', message: '로그인이 필요해요.' };

  const { data, error } = await supabase.rpc('apply_to_shift', { p_shift_id: shiftId });
  if (error || typeof data !== 'string') {
    const message = error?.message?.replace(/^.*?: /, '') ?? '지원 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.';
    return { ok: false, reason: classify(message), message };
  }
  return { ok: true, applicationId: data };
}

export async function cancelApplication(applicationId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancel_my_shift_application', {
    p_application_id: applicationId,
  });
  return !error && data === true;
}
