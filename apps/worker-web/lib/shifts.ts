import { supabase } from './supabase';

export type ApplyShiftResult =
  | { ok: true; applicationId: string }
  | { ok: false; message: string; reason?: 'auth' | 'worker' | 'duplicate' | 'unavailable' | 'error' };

export async function applyToShift(shiftId: string): Promise<ApplyShiftResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'auth', message: '로그인이 필요해요.' };

  const { data: worker } = await supabase
    .from('workers')
    .select('id, role, verification_status')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!worker || worker.verification_status !== 'approved') {
    return { ok: false, reason: 'worker', message: '심사 승인 후 지원할 수 있어요.' };
  }

  const { data: shift } = await supabase
    .from('shifts')
    .select('id, status, required_role')
    .eq('id', shiftId)
    .maybeSingle();

  if (!shift || shift.status !== 'open') {
    return { ok: false, reason: 'unavailable', message: '현재 지원할 수 없는 시프트예요.' };
  }

  if (shift.required_role !== 'any' && shift.required_role !== worker.role) {
    return { ok: false, reason: 'unavailable', message: '자격 조건이 맞지 않는 시프트예요.' };
  }

  const { data: existing } = await supabase
    .from('shift_applications')
    .select('id')
    .eq('shift_id', shiftId)
    .eq('worker_id', worker.id)
    .maybeSingle();

  if (existing) {
    return { ok: false, reason: 'duplicate', message: '이미 지원한 시프트예요.' };
  }

  const { data, error } = await supabase
    .from('shift_applications')
    .insert({ shift_id: shiftId, worker_id: worker.id })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, reason: 'error', message: '지원 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' };
  }

  return { ok: true, applicationId: data.id };
}

export async function cancelApplication(applicationId: string, workerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('shift_applications')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', applicationId)
    .eq('worker_id', workerId)
    .eq('status', 'applied')
    .select('id')
    .maybeSingle();

  return !error && !!data;
}
