'use server';
import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { userClient } from '@/lib/supabase';

export async function updatePaymentStatus(formData: FormData) {
  const context = await requireAdminContext(['owner','super']);
  const id = String(formData.get('id') ?? '');
  const action = String(formData.get('action') ?? '');
  if (!id || !['approve','mark_exported','mark_paid'].includes(action)) throw new Error('올바르지 않은 지급 요청입니다.');
  const sb = userClient(context.accessToken);
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const { error } = await sb.rpc('update_wage_payment_status', {
    p_instruction_id: id, p_action: action, p_payment_reference: null, p_dispute_reason: null,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/payroll');
}
