'use server';

import { redirect } from 'next/navigation';
import { createShift } from '../db/shifts';
import { adminClient } from '../supabase';
import { requireAdminContext } from '../admin-auth';
import { calcEstimatedShiftPay, MIN_HOURLY_WAGE_2026 } from '../pay';
import { consumePlanUsage, releasePlanUsage, requirePlanFeature } from '../billing-gates';
import { todayKST } from '../date';
import { nudgeNotificationDispatch } from '../notify-nudge';

const ALL_ROLES = ['rn', 'na', 'pharmacist', 'pharmacy_staff'] as const;
const ROLE_LABEL: Record<string, string> = {
  rn: '간호사', na: '간호조무사', pharmacist: '약사',
  pharmacy_staff: '약국 전산·사무직', any: '자격 무관 인력',
};
const PHARMACY_STAFF_LICENSED_TASK = /(조제|복약\s*지도|복약지도|의약품\s*(판매|조제)|처방\s*(검토|감사)|최종\s*(검수|확인))/;

export type ShiftActionResult = { ok: false; message: string } | void;

// 프로덕션은 서버 액션 throw 메시지를 마스킹하므로, 검증·한도 안내는 결과 객체로 돌려준다.
export async function createShiftAction(formData: FormData): Promise<ShiftActionResult> {
  const shiftDate = String(formData.get('shift_date') ?? '');
  const startTime = String(formData.get('start_time') ?? '');
  const endTime = String(formData.get('end_time') ?? '');
  const hourlyWage = Number.parseInt(String(formData.get('hourly_wage') ?? ''), 10);
  const requiredRole = String(formData.get('required_role') ?? '') as 'rn' | 'na' | 'pharmacist' | 'pharmacy_staff' | 'any';
  const description = String(formData.get('description') ?? '').trim();
  const department = String(formData.get('department') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  const invitedWorkerId = String(formData.get('invited_worker_id') ?? '').trim() || null;

  if (!shiftDate || !startTime || !endTime || !requiredRole || !description) return { ok: false, message: '필수 항목을 모두 입력해 주세요.' };
  if (![...ALL_ROLES,'any'].includes(requiredRole)) return { ok: false, message: '필요 자격이 올바르지 않습니다.' };
  if (requiredRole === 'pharmacy_staff' && PHARMACY_STAFF_LICENSED_TASK.test([description, department, notes].filter(Boolean).join(' '))) {
    return { ok: false, message: '약국 전산·사무직 공고에는 조제·복약지도·의약품 판매 등 약사 면허 업무를 포함할 수 없어요.' };
  }
  if (!Number.isFinite(hourlyWage) || hourlyWage < MIN_HOURLY_WAGE_2026) return { ok: false, message: '시급은 2026년 최저시급 이상이어야 합니다.' };
  const estimatedTotalPay = calcEstimatedShiftPay(startTime, endTime, hourlyWage);
  if (estimatedTotalPay == null) return { ok: false, message: '근무 시간을 확인해 주세요.' };

  const context = await requireAdminContext(['owner','operator','super']);
  const sb = adminClient();
  if (sb) {
    const { data: facility } = await sb.from('facilities').select('facility_type').eq('id', context.facilityId).maybeSingle();
    if (requiredRole === 'pharmacy_staff' && facility?.facility_type !== 'pharmacy') {
      return { ok: false, message: '약국 전산·사무직 공고는 약국 사업장에서만 등록할 수 있어요.' };
    }
    if (facility?.facility_type === 'pharmacy' && !['pharmacist','pharmacy_staff'].includes(requiredRole)) {
      return { ok: false, message: '약국 공고는 약사 또는 약국 전산·사무직을 선택해 주세요.' };
    }
  }
  let invitedWorker: { id: string; auth_user_id: string | null; name: string; role: string } | null = null;
  if (invitedWorkerId) {
    if (!sb) return { ok: false, message: '서버 설정을 확인해 주세요.' };
    try {
      await requirePlanFeature(sb, context.facilityId, 'repeat_invite');
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '요금제를 확인해 주세요.' };
    }
    const { data: poolMember } = await sb.from('facility_worker_pool')
      .select('worker_id,status,workers(id,auth_user_id,name,role,verification_status,deleted_at)')
      .eq('facility_id', context.facilityId).eq('worker_id', invitedWorkerId).eq('status', 'active').maybeSingle();
    const worker = (poolMember as any)?.workers;
    if (!worker || worker.deleted_at || worker.verification_status !== 'approved') return { ok: false, message: '초대 가능한 인력풀 워커가 아니에요.' };
    if (requiredRole !== 'any' && worker.role !== requiredRole) return { ok: false, message: '워커 자격과 시프트 자격이 일치하지 않아요.' };
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

  if (!sb) {
    return { ok: false, message: '서버 설정을 확인해 주세요.' };
  }
  const monthKey = todayKST().slice(0, 7);
  const postingUsageKey = `job_posting:${context.facilityId}:${shiftId}`;
  const inviteUsageKey = invitedWorker
    ? `repeat_invite_worker:${context.facilityId}:${monthKey}:${invitedWorker.id}`
    : null;
  let inviteUsageCreated = false;
  try {
    await consumePlanUsage(sb, context.facilityId, 'job_posting_slot', 1, postingUsageKey);
    if (inviteUsageKey) {
      inviteUsageCreated = await consumePlanUsage(sb, context.facilityId, 'active_worker', 1, inviteUsageKey);
    }
  } catch (error) {
    await sb.from('shifts').delete().eq('id', shiftId).eq('facility_id', context.facilityId);
    await releasePlanUsage(sb, postingUsageKey);
    if (inviteUsageKey && inviteUsageCreated) await releasePlanUsage(sb, inviteUsageKey);
    // 플랜 한도·업그레이드 안내가 프로덕션에서 마스킹되지 않도록 결과 객체로
    return { ok: false, message: error instanceof Error ? error.message : '요금제 한도를 확인해 주세요.' };
  }

  if (invitedWorker) {
    const { error: applicationError } = await sb.from('shift_applications').insert({
      shift_id: shiftId, worker_id: invitedWorker.id, status: 'invited',
    });
    if (applicationError) {
      await sb.from('shifts').delete().eq('id', shiftId).eq('facility_id', context.facilityId);
      await releasePlanUsage(sb, postingUsageKey);
      if (inviteUsageKey && inviteUsageCreated) await releasePlanUsage(sb, inviteUsageKey);
      return { ok: false, message: '반복근무 요청을 만들지 못했어요. 다시 시도해 주세요.' };
    }
  }

  // Notification failures do not roll back the shift; durable outbox is retried by cron.
  try {
    if (sb) {
      let workers: Array<{ auth_user_id: string | null }> = [];
      if (invitedWorker) {
        workers = [{ auth_user_id: invitedWorker.auth_user_id }];
      } else {
        const { data, error: workerError } = await sb.rpc('get_shift_notification_recipients', {
          p_shift_id: shiftId,
        });
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
        await nudgeNotificationDispatch();
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
  // 확정(matched)된 근무를 취소하면 워커의 일정이 사라진다 — 취소 전 매칭 워커를 확보해 알린다
  const { data: before } = await sb.from('shifts')
    .select('id, shift_date, start_time, status, matched_worker_id, workers:matched_worker_id ( auth_user_id )')
    .eq('id', shiftId).eq('facility_id', context.facilityId).maybeSingle();
  const { data, error } = await sb.from('shifts')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', shiftId)
    .eq('facility_id', context.facilityId)
    .in('status', ['open','matched'])
    .select('id')
    .maybeSingle();
  if (error || !data) throw new Error('취소할 수 없는 시프트예요.');
  const matchedAuthId = (before as unknown as { status?: string; workers?: { auth_user_id?: string | null } | null } | null)
    ?.status === 'matched'
    ? (before as unknown as { workers?: { auth_user_id?: string | null } | null }).workers?.auth_user_id
    : null;
  if (matchedAuthId && before) {
    await sb.from('notification_outbox').upsert([{
      worker_auth_user_id: matchedAuthId,
      event_type: 'shift.cancelled',
      dedupe_key: `shift.cancelled:${shiftId}:${matchedAuthId}`,
      title: '확정된 근무가 취소됐어요',
      body: `${(before as { shift_date?: string }).shift_date ?? ''} 근무가 사업장 사정으로 취소됐습니다. 다른 근무를 확인해 보세요.`,
      data: { url: '/applications', shiftId },
    }], { onConflict: 'dedupe_key', ignoreDuplicates: true });
    await nudgeNotificationDispatch();
  }
  redirect('/shifts');
}
