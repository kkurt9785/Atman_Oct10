'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { calcEstimatedShiftPay, MIN_HOURLY_WAGE_2026 } from '@/lib/pay';
import { consumePlanUsage, releasePlanUsage, requirePlanFeature } from '@/lib/billing-gates';
import { todayKST } from '@/lib/date';

const VALID_ROLES = ['rn', 'na', 'any'];

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

export async function createShiftTemplateAction(formData: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  await requirePlanFeature(sb, context.facilityId, 'operations');
  const name = formText(formData, 'name');
  const requiredRole = formText(formData, 'required_role');
  const startTime = formText(formData, 'start_time');
  const endTime = formText(formData, 'end_time');
  const hourlyWage = Number.parseInt(formText(formData, 'hourly_wage'), 10);
  const description = formText(formData, 'description');
  const department = formText(formData, 'department') || null;
  const requiredHeadcount = Math.min(20, Math.max(1, Number.parseInt(formText(formData, 'required_headcount'), 10) || 1));
  const weekdays = formData.getAll('weekdays').map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  if (!name || !VALID_ROLES.includes(requiredRole) || !startTime || !endTime || !description || weekdays.length === 0) throw new Error('템플릿 필수 항목을 확인해 주세요.');
  if (!Number.isFinite(hourlyWage) || hourlyWage < MIN_HOURLY_WAGE_2026 || calcEstimatedShiftPay(startTime, endTime, hourlyWage) == null) throw new Error('근무시간과 시급을 확인해 주세요.');
  const { error } = await sb.from('shift_templates').insert({
    facility_id: context.facilityId, name, required_role: requiredRole,
    weekdays: [...new Set(weekdays)].sort(), start_time: startTime, end_time: endTime,
    hourly_wage: hourlyWage, description, department, required_headcount: requiredHeadcount, created_by: context.user.id,
  });
  if (error) throw new Error('반복 일정 템플릿을 저장하지 못했어요.');
  revalidatePath('/operations');
}

export async function generateRecurringShiftsAction(formData: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  await requirePlanFeature(sb, context.facilityId, 'operations');
  const templateId = formText(formData, 'template_id');
  const startDate = formText(formData, 'start_date');
  const weeks = Math.min(8, Math.max(1, Number.parseInt(formText(formData, 'weeks'), 10) || 4));
  if (!templateId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('생성 시작일을 확인해 주세요.');

  const { data: template } = await sb.from('shift_templates').select('*')
    .eq('id', templateId).eq('facility_id', context.facilityId).eq('is_active', true).maybeSingle();
  if (!template) throw new Error('사용 가능한 템플릿이 아니에요.');
  const estimatedPay = calcEstimatedShiftPay(template.start_time, template.end_time, template.hourly_wage);
  if (estimatedPay == null) throw new Error('템플릿 근무조건을 확인해 주세요.');

  const start = new Date(`${startDate}T00:00:00Z`);
  const dates: string[] = [];
  for (let offset = 0; offset < weeks * 7; offset += 1) {
    const date = new Date(start.getTime() + offset * 86_400_000);
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    if ((template.weekdays as number[]).includes(weekday)) dates.push(date.toISOString().slice(0, 10));
  }
  if (!dates.length) throw new Error('선택 요일에 생성할 날짜가 없어요.');
  const { data: existing } = await sb.from('shifts').select('shift_date,template_slot')
    .eq('template_id', templateId).in('shift_date', dates).neq('status', 'cancelled');
  const existingSlots = new Set((existing ?? []).map((row: any) => `${row.shift_date}:${row.template_slot ?? 1}`));
  const batchId = randomUUID();
  const rows = dates.flatMap((date) => Array.from({ length: template.required_headcount ?? 1 }, (_, index) => index + 1)
    .filter((slot) => !existingSlots.has(`${date}:${slot}`))
    .map((slot) => ({
      facility_id: context.facilityId, template_id: templateId, template_slot: slot, generation_batch_id: batchId,
      audience: 'public', invited_worker_id: null, required_role: template.required_role,
      shift_date: date, start_time: template.start_time, end_time: template.end_time,
      hourly_wage: template.hourly_wage, estimated_total_pay: estimatedPay,
      description: template.description, department: template.department, notes: template.notes,
      posted_by: context.user.id,
    })));
  if (!rows.length) throw new Error('이미 같은 날짜의 반복 시프트가 생성되어 있어요.');
  const { error } = await sb.from('shifts').insert(rows);
  if (error) throw new Error('반복 시프트를 생성하지 못했어요.');

  const usageKey = `job_posting_batch:${context.facilityId}:${batchId}`;
  try {
    await consumePlanUsage(sb, context.facilityId, 'job_posting_slot', rows.length, usageKey);
  } catch (error) {
    await sb.from('shifts').delete().eq('facility_id', context.facilityId).eq('generation_batch_id', batchId);
    await releasePlanUsage(sb, usageKey);
    throw error;
  }

  const roleFilter = template.required_role === 'any' ? ['rn', 'na'] : [template.required_role];
  const { data: workers } = await sb.from('workers').select('auth_user_id').in('role', roleFilter)
    .eq('verification_status', 'approved').is('deleted_at', null);
  const outbox = (workers ?? []).filter((worker: any) => worker.auth_user_id).map((worker: any) => ({
    worker_auth_user_id: worker.auth_user_id,
    event_type: 'shift.batch_created', dedupe_key: `shift.batch_created:${batchId}:${worker.auth_user_id}`,
    title: `새 반복 시프트 ${rows.length}건`, body: `${template.name} · ${startDate}부터 확인해 보세요`,
    data: { type: 'new_shift_batch', batchId },
  }));
  if (outbox.length) await sb.from('notification_outbox').upsert(outbox, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  revalidatePath('/operations');
  revalidatePath('/shifts');
}

export async function requestUrgentReplacementAction(formData: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  await requirePlanFeature(sb, context.facilityId, 'operations');
  const shiftId = formText(formData, 'shift_id');
  const kind = formText(formData, 'kind');
  if (!['unfilled', 'no_show'].includes(kind)) throw new Error('긴급 요청 유형이 올바르지 않아요.');
  const { data: original } = await sb.from('shifts').select('*').eq('id', shiftId).eq('facility_id', context.facilityId).in('status', ['open','matched']).maybeSingle();
  if (!original) throw new Error('긴급 요청 가능한 시프트를 찾지 못했어요.');
  let target = original;
  const startMs = Date.parse(`${original.shift_date}T${original.start_time}+09:00`);
  if (!Number.isFinite(startMs)) throw new Error('근무 시작 시간을 확인할 수 없어요.');
  if (kind === 'unfilled') {
    if (original.status !== 'open' || startMs < Date.now() || startMs > Date.now() + 48 * 60 * 60_000) {
      throw new Error('48시간 안에 시작하는 미충원 공고만 긴급 알림을 보낼 수 있어요.');
    }
    const { data: applicant } = await sb.from('shift_applications').select('id')
      .eq('shift_id', original.id).in('status', ['applied', 'accepted']).limit(1).maybeSingle();
    if (applicant) throw new Error('이미 지원자가 있는 공고는 미충원 긴급 알림 대상이 아니에요.');
  }
  if (kind === 'no_show') {
    if (original.status !== 'matched') throw new Error('확정된 근무만 노쇼 대체 요청을 할 수 있어요.');
    if (original.shift_date < todayKST() && !original.is_overnight) {
      throw new Error('지난 일반 근무는 노쇼 대체 요청 대상이 아니에요.');
    }
    if (Date.now() < startMs + 30 * 60_000) {
      throw new Error('근무 시작 30분 후에도 출근하지 않은 경우에만 대체 요청할 수 있어요.');
    }
    const { data: attendance } = await sb.from('shift_attendances').select('id')
      .eq('shift_id', original.id).not('check_in_at', 'is', null).limit(1).maybeSingle();
    if (attendance) throw new Error('이미 출근 확인된 근무는 노쇼 처리할 수 없어요.');
    const { data: existing } = await sb.from('shifts').select('*').eq('replacement_for_shift_id', shiftId).neq('status', 'cancelled').maybeSingle();
    if (existing) target = existing;
    else {
      const { data: created, error } = await sb.from('shifts').insert({
        facility_id: context.facilityId, required_role: original.required_role, required_credentials: original.required_credentials,
        shift_date: original.shift_date, start_time: original.start_time, end_time: original.end_time,
        hourly_wage: original.hourly_wage, estimated_total_pay: original.estimated_total_pay,
        description: `[긴급 대체] ${original.description}`, department: original.department,
        notes: '기존 확정 인력 미출근으로 인한 긴급 대체 요청', audience: 'public',
        replacement_for_shift_id: original.id, is_replacement: true, posted_by: context.user.id,
      }).select('*').single();
      if (error || !created) throw new Error('긴급 대체 시프트를 만들지 못했어요.');
      target = created;
      const usageKey = `job_posting:${context.facilityId}:${created.id}`;
      try {
        await consumePlanUsage(sb, context.facilityId, 'job_posting_slot', 1, usageKey);
      } catch (usageError) {
        await sb.from('shifts').delete().eq('id', created.id).eq('facility_id', context.facilityId);
        await releasePlanUsage(sb, usageKey);
        throw usageError;
      }
    }
  }
  const roles = target.required_role === 'any' ? ['rn','na'] : [target.required_role];
  const { data: workers } = await sb.from('workers').select('auth_user_id').in('role', roles).eq('verification_status', 'approved').is('deleted_at', null);
  const hourKey = new Date().toISOString().slice(0, 13);
  const outbox = (workers ?? []).filter((worker: any) => worker.auth_user_id).map((worker: any) => ({
    worker_auth_user_id: worker.auth_user_id, event_type: 'shift.urgent',
    dedupe_key: `shift.urgent:${target.id}:${hourKey}:${worker.auth_user_id}`,
    title: kind === 'no_show' ? '긴급 대체 근무 요청' : '48시간 내 긴급 시프트',
    body: `${target.shift_date} ${target.start_time.slice(0,5)} · ${target.department ?? '병동 근무'}`,
    data: { type: 'urgent_shift', shiftId: target.id },
  }));
  if (outbox.length) await sb.from('notification_outbox').upsert(outbox, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  revalidatePath('/operations');
  revalidatePath('/shifts');
}

export async function deactivateShiftTemplateAction(formData: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const id = formText(formData, 'template_id');
  const { error } = await sb.from('shift_templates').update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id).eq('facility_id', context.facilityId);
  if (error) throw new Error('템플릿을 중지하지 못했어요.');
  revalidatePath('/operations');
}
