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
  const invitedWorkerId = String(formData.get('invited_worker_id') ?? '').trim() || null;

  if (!shiftDate || !startTime || !endTime || !requiredRole || !description) throw new Error('필수 항목을 모두 입력해 주세요.');
  if (!['rn','na','any'].includes(requiredRole)) throw new Error('필요 자격이 올바르지 않습니다.');
  if (!Number.isFinite(hourlyWage) || hourlyWage < MIN_HOURLY_WAGE_2026) throw new Error('시급은 2026년 최저시급 이상이어야 합니다.');
  const estimatedTotalPay = calcEstimatedShiftPay(startTime, endTime, hourlyWage);
  if (estimatedTotalPay == null) throw new Error('근무 시간을 확인해 주세요.');

  const context = await requireAdminContext(['owner','operator','super']);
  const sb = adminClient();
  let invitedWorker: { id: string; auth_user_id: string | null; name: string; role: string } | null = null;
  if (invitedWorkerId) {
    if (!sb) throw new Error('서버 설정을 확인해 주세요.');
    const { data: poolMember } = await sb.from('facility_worker_pool')
      .select('worker_id,status,workers(id,auth_user_id,name,role,verification_status,deleted_at)')
      .eq('facility_id', context.facilityId).eq('worker_id', invitedWorkerId).eq('status', 'active').maybeSingle();
    const worker = (poolMember as any)?.workers;
    if (!worker || worker.deleted_at || worker.verification_status !== 'approved') throw new Error('초대 가능한 인력풀 워커가 아니에요.');
    if (requiredRole !== 'any' && worker.role !== requiredRole) throw new Error('워커 자격과 시프트 자격이 일치하지 않아요.');
    invitedWorker = worker;
  }
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
    audience: invitedWorker ? 'invited' : 'public',
    invited_worker_id: invitedWorker?.id ?? null,
  });

  if (invitedWorker && sb) {
    const { error: applicationError } = await sb.from('shift_applications').insert({
      shift_id: shiftId, worker_id: invitedWorker.id, status: 'invited',
    });
    if (applicationError) {
      await sb.from('shifts').delete().eq('id', shiftId).eq('facility_id', context.facilityId);
      throw new Error('반복근무 요청을 만들지 못했어요. 다시 시도해 주세요.');
    }
  }

  // Notification failures do not roll back the shift; durable outbox is retried by cron.
  try {
    if (sb) {
      let workers: Array<{ auth_user_id: string | null }> = [];
      if (invitedWorker) {
        workers = [{ auth_user_id: invitedWorker.auth_user_id }];
      } else {
        const roleFilter = requiredRole === 'any' ? ['rn','na'] : [requiredRole];
        const { data, error: workerError } = await sb.from('workers').select('auth_user_id')
          .in('role', roleFilter).eq('verification_status', 'approved').is('deleted_at', null);
        if (workerError) throw workerError;
        workers = data ?? [];
      }

      const title = invitedWorker ? `${invitedWorker.name} 님, 반복근무 요청이 왔어요` : `새 시프트 공고 — ${ROLE_LABEL[requiredRole]}`;
      const body = `${shiftDate} ${startTime.slice(0,5)}~${endTime.slice(0,5)} · ${estimatedTotalPay.toLocaleString('ko-KR')}원`;
      const rows = (workers ?? [])
        .filter((worker: { auth_user_id: string | null }) => Boolean(worker.auth_user_id))
        .map((worker: { auth_user_id: string | null }) => ({
          worker_auth_user_id: worker.auth_user_id,
          event_type: invitedWorker ? 'shift.invited' : 'shift.created',
          dedupe_key: `${invitedWorker ? 'shift.invited' : 'shift.created'}:${shiftId}:${worker.auth_user_id}`,
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
