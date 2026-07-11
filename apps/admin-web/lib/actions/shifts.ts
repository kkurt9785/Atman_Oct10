'use server';

import { redirect } from 'next/navigation';
import { createShift } from '../db/shifts';
import { adminClient } from '../supabase';
import { requireAdminContext } from '../admin-auth';
import { calcEstimatedShiftPay, MIN_HOURLY_WAGE_2026 } from '../pay';

const ROLE_LABEL: Record<string, string> = { rn: '간호사', na: '간호조무사', any: '간호인력' };

export async function createShiftAction(formData: FormData) {
  const shiftDate = String(formData.get('shift_date') ?? '');
  const startTime = String(formData.get('start_time') ?? '');
  const endTime = String(formData.get('end_time') ?? '');
  const hourlyWage = Number.parseInt(String(formData.get('hourly_wage') ?? ''), 10);
  const requiredRole = String(formData.get('required_role') ?? '') as 'rn' | 'na' | 'any';
  const description = String(formData.get('description') ?? '').trim();
  const department = String(formData.get('department') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!shiftDate || !startTime || !endTime || !requiredRole || !description) throw new Error('필수 항목을 모두 입력해 주세요.');
  if (!['rn','na','any'].includes(requiredRole)) throw new Error('필요 자격이 올바르지 않습니다.');
  if (!Number.isFinite(hourlyWage) || hourlyWage < MIN_HOURLY_WAGE_2026) throw new Error('시급은 2026년 최저시급 이상이어야 합니다.');
  const estimatedTotalPay = calcEstimatedShiftPay(startTime, endTime, hourlyWage);
  if (estimatedTotalPay == null) throw new Error('근무 시간을 확인해 주세요.');

  const context = await requireAdminContext(['owner','operator','super']);
  const shiftId = await createShift({
    shift_date: shiftDate,
    start_time: startTime,
    end_time: endTime,
    required_role: requiredRole,
    hourly_wage: hourlyWage,
    estimated_total_pay: estimatedTotalPay,
    description,
    department,
    notes,
  });

  // Notification failures do not roll back the shift; durable outbox is retried by cron.
  try {
    const sb = adminClient();
    if (sb) {
      const roleFilter = requiredRole === 'any' ? ['rn','na'] : [requiredRole];
      const { data: workers, error: workerError } = await sb
        .from('workers')
        .select('auth_user_id')
        .in('role', roleFilter)
        .eq('verification_status', 'approved')
        .is('deleted_at', null);
      if (workerError) throw workerError;

      const title = `새 시프트 공고 — ${ROLE_LABEL[requiredRole]}`;
      const body = `${shiftDate} ${startTime.slice(0,5)}~${endTime.slice(0,5)} · ${estimatedTotalPay.toLocaleString('ko-KR')}원`;
      const rows = (workers ?? [])
        .filter((worker: { auth_user_id: string | null }) => Boolean(worker.auth_user_id))
        .map((worker: { auth_user_id: string | null }) => ({
          worker_auth_user_id: worker.auth_user_id,
          event_type: 'shift.created',
          dedupe_key: `shift.created:${shiftId}:${worker.auth_user_id}`,
          title,
          body,
          data: { type: 'new_shift', shiftId },
        }));
      if (rows.length > 0) {
        const { error: outboxError } = await sb.from('notification_outbox').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
        if (outboxError) throw outboxError;
      }
    }
  } catch (error) {
    console.error('[shift/outbox] enqueue failed', error);
  }

  redirect('/shifts');
}

export async function cancelShiftAction(shiftId: string) {
  const context = await requireAdminContext(['owner','operator','super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정 오류');
  const { data, error } = await sb.from('shifts')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', shiftId)
    .eq('facility_id', context.facilityId)
    .in('status', ['open','matched'])
    .select('id')
    .maybeSingle();
  if (error || !data) throw new Error('취소할 수 없는 시프트예요.');
  redirect('/shifts');
}
