'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin-auth';
import { adminClient } from '@/lib/supabase';
import { calcEstimatedShiftPay, MIN_HOURLY_WAGE_2026 } from '@/lib/pay';
import { consumePlanUsage, releasePlanUsage, requirePlanFeature } from '@/lib/billing-gates';
import { todayKST } from '@/lib/date';
import { nudgeNotificationDispatch } from '@/lib/notify-nudge';
import { getWorkforceRecommendations } from '@/lib/db/operations';

const VALID_ROLES = ['rn', 'na', 'pharmacist', 'pharmacy_staff', 'any'];

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

export async function resetFacilityLiveDemoAction() {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const { data: facility } = await sb.from('facilities')
    .select('is_demo,business_registration_number').eq('id', context.facilityId).maybeSingle();
  if (!facility?.is_demo || !['DEMO-TARGET-0001','DEMO-TARGET-PHARMACY','DEMO-TARGET-0026'].includes(facility.business_registration_number)) {
    throw new Error('세 영업 데모 시설에서만 초기화할 수 있어요.');
  }
  const { error } = await sb.rpc('reset_three_facility_live_demo', { p_facility_id: context.facilityId });
  if (error) throw new Error('시연 공고를 초기화하지 못했어요. 잠시 후 다시 시도해 주세요.');
  const { data: demoShifts } = await sb.from('shifts').select('id,shift_date,start_time,department')
    .eq('facility_id', context.facilityId).like('notes', 'LIVE-SALES-DEMO-%').eq('status', 'open');
  const outbox = [] as Array<Record<string, unknown>>;
  for (const shift of demoShifts ?? []) {
    const { data: recipients } = await sb.rpc('get_shift_notification_recipients', { p_shift_id: shift.id });
    for (const recipient of recipients ?? []) if (recipient.auth_user_id) outbox.push({
      worker_auth_user_id: recipient.auth_user_id,
      event_type: 'shift.demo_ready',
      dedupe_key: `shift.demo_ready:${shift.id}:${recipient.auth_user_id}`,
      title: '시연용 새 근무가 도착했어요',
      body: `${shift.shift_date} ${shift.start_time.slice(0,5)} · ${shift.department ?? '사업장 근무'}`,
      data: { type: 'new_shift', shiftId: shift.id, url: '/shifts' },
    });
  }
  if (outbox.length) {
    const { error: outboxError } = await sb.from('notification_outbox').upsert(outbox, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (outboxError) throw new Error('시연 공고는 만들었지만 워커 알림을 저장하지 못했어요.');
    await nudgeNotificationDispatch();
  }
  revalidatePath('/');
  revalidatePath('/applications');
  revalidatePath('/chats');
  revalidatePath('/operations');
  revalidatePath('/shifts');
  redirect('/operations?notice=live_demo_reset');
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
  const { data: facility } = await sb.from('facilities').select('facility_type').eq('id', context.facilityId).single();
  if (facility?.facility_type === 'pharmacy' && !['pharmacist', 'pharmacy_staff'].includes(requiredRole)) {
    throw new Error('약국 템플릿은 약사 또는 약국 전산·사무직만 선택할 수 있어요.');
  }
  if (!Number.isFinite(hourlyWage) || hourlyWage < MIN_HOURLY_WAGE_2026 || calcEstimatedShiftPay(startTime, endTime, hourlyWage) == null) throw new Error('근무시간과 시급을 확인해 주세요.');
  const { error } = await sb.from('shift_templates').insert({
    facility_id: context.facilityId, name, required_role: requiredRole,
    weekdays: [...new Set(weekdays)].sort(), start_time: startTime, end_time: endTime,
    hourly_wage: hourlyWage, description, department, required_headcount: requiredHeadcount, created_by: context.user.id,
  });
  if (error) throw new Error('반복 일정 템플릿을 저장하지 못했어요.');
  revalidatePath('/operations');
  redirect('/operations?notice=template_saved');
}

export async function createStaffingRequirementAction(formData: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  await requirePlanFeature(sb, context.facilityId, 'operations');
  const name = formText(formData, 'name');
  const department = formText(formData, 'department') || null;
  const requiredRole = formText(formData, 'required_role');
  const startTime = formText(formData, 'start_time');
  const endTime = formText(formData, 'end_time');
  const requiredHeadcount = Math.min(100, Math.max(1, Number.parseInt(formText(formData, 'required_headcount'), 10) || 1));
  const hourlyWage = Number.parseInt(formText(formData, 'replacement_hourly_wage'), 10);
  const description = formText(formData, 'replacement_description');
  const weekdays = [...new Set(formData.getAll('weekdays').map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort();
  if (!name || !VALID_ROLES.includes(requiredRole) || !startTime || !endTime || !description || !weekdays.length) throw new Error('필요 인원 기준의 필수 항목을 확인해 주세요.');
  if (!Number.isFinite(hourlyWage) || hourlyWage < MIN_HOURLY_WAGE_2026 || calcEstimatedShiftPay(startTime, endTime, hourlyWage) == null) throw new Error('대체 모집 시 적용할 시간과 시급을 확인해 주세요.');
  const { data: facility } = await sb.from('facilities').select('facility_type').eq('id', context.facilityId).single();
  if (facility?.facility_type === 'pharmacy' && !['pharmacist', 'pharmacy_staff'].includes(requiredRole)) throw new Error('약국은 약사 또는 약국 전산·사무직 기준을 선택해 주세요.');
  const { error } = await sb.from('staffing_requirements').insert({
    facility_id: context.facilityId, name, department, required_role: requiredRole,
    weekdays, start_time: startTime, end_time: endTime, required_headcount: requiredHeadcount,
    replacement_hourly_wage: hourlyWage, replacement_description: description, created_by: context.user.id,
  });
  if (error?.code === '23505') throw new Error('같은 부서·직군·시간대의 필요 인원 기준이 이미 있어요.');
  if (error) throw new Error('필요 인원 기준을 저장하지 못했어요. 마이그레이션 적용 상태를 확인해 주세요.');
  revalidatePath('/operations');
  redirect('/operations?notice=requirement_saved');
}

export async function deactivateStaffingRequirementAction(formData: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const requirementId = formText(formData, 'requirement_id');
  const { error } = await sb.from('staffing_requirements').update({ is_active: false })
    .eq('id', requirementId).eq('facility_id', context.facilityId);
  if (error) throw new Error('필요 인원 기준을 중지하지 못했어요.');
  revalidatePath('/operations');
  redirect('/operations?notice=requirement_off');
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

  const recipientIds = new Set<string>();
  const { data: generatedShifts } = await sb.from('shifts').select('id').eq('generation_batch_id', batchId);
  for (const row of generatedShifts ?? []) {
    const { data: recipients } = await sb.rpc('get_shift_notification_recipients', { p_shift_id: row.id });
    for (const recipient of recipients ?? []) if (recipient.auth_user_id) recipientIds.add(recipient.auth_user_id as string);
  }
  const outbox = [...recipientIds].map((authUserId) => ({
    worker_auth_user_id: authUserId,
    event_type: 'shift.batch_created', dedupe_key: `shift.batch_created:${batchId}:${authUserId}`,
    title: `새 반복 시프트 ${rows.length}건`, body: `${template.name} · ${startDate}부터 확인해 보세요`,
    data: { type: 'new_shift_batch', batchId, url: '/shifts' },
  }));
  if (outbox.length) {
    await sb.from('notification_outbox').upsert(outbox, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    await nudgeNotificationDispatch();
  }
  revalidatePath('/operations');
  revalidatePath('/shifts');
  redirect('/operations?notice=generated');
}

export async function fillSevenDayScheduleGapsAction() {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  await requirePlanFeature(sb, context.facilityId, 'operations');
  const startDate = todayKST();
  const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const [{ data: templates }, { data: existing }] = await Promise.all([
    sb.from('shift_templates').select('*').eq('facility_id', context.facilityId).eq('is_active', true),
    sb.from('shifts').select('template_id,shift_date,template_slot').eq('facility_id', context.facilityId)
      .gte('shift_date', startDate).lte('shift_date', endDate).neq('status', 'cancelled'),
  ]);
  if (!templates?.length) throw new Error('먼저 반복 근무 템플릿을 하나 만들어 주세요.');
  const existingSlots = new Set((existing ?? []).map((row: any) => `${row.template_id}:${row.shift_date}:${row.template_slot ?? 1}`));
  const batchId = randomUUID();
  const rows: any[] = [];
  for (const template of templates as any[]) {
    const estimatedPay = calcEstimatedShiftPay(template.start_time, template.end_time, template.hourly_wage);
    if (estimatedPay == null) continue;
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(Date.parse(`${startDate}T00:00:00Z`) + offset * 86_400_000);
      const weekday = date.getUTCDay() || 7;
      const shiftDate = date.toISOString().slice(0, 10);
      if (!(template.weekdays ?? []).includes(weekday)) continue;
      for (let slot = 1; slot <= Number(template.required_headcount ?? 1); slot += 1) {
        if (existingSlots.has(`${template.id}:${shiftDate}:${slot}`)) continue;
        rows.push({
          facility_id: context.facilityId, template_id: template.id, template_slot: slot, generation_batch_id: batchId,
          audience: 'public', invited_worker_id: null, required_role: template.required_role,
          shift_date: shiftDate, start_time: template.start_time, end_time: template.end_time,
          hourly_wage: template.hourly_wage, estimated_total_pay: estimatedPay,
          description: template.description, department: template.department, notes: template.notes,
          posted_by: context.user.id,
        });
      }
    }
  }
  if (!rows.length) redirect('/operations?notice=no_schedule_gap');
  const { error } = await sb.from('shifts').insert(rows);
  if (error) throw new Error('근무표 공백을 생성하지 못했어요.');
  const usageKey = `job_posting_batch:${context.facilityId}:${batchId}`;
  try {
    await consumePlanUsage(sb, context.facilityId, 'job_posting_slot', rows.length, usageKey);
  } catch (usageError) {
    await sb.from('shifts').delete().eq('facility_id', context.facilityId).eq('generation_batch_id', batchId);
    await releasePlanUsage(sb, usageKey);
    throw usageError;
  }
  const recipientIds = new Set<string>();
  const { data: generated } = await sb.from('shifts').select('id').eq('generation_batch_id', batchId);
  for (const shift of generated ?? []) {
    const { data: recipients, error: recipientError } = await sb.rpc('get_shift_notification_recipients', { p_shift_id: shift.id });
    if (recipientError) {
      await sb.from('shifts').delete().eq('facility_id', context.facilityId).eq('generation_batch_id', batchId);
      await releasePlanUsage(sb, usageKey);
      throw new Error('알림 대상을 확인하지 못해 공고 생성을 취소했어요. 다시 시도해 주세요.');
    }
    for (const recipient of recipients ?? []) if (recipient.auth_user_id) recipientIds.add(recipient.auth_user_id as string);
  }
  if (recipientIds.size) {
    const { error: outboxError } = await sb.from('notification_outbox').upsert([...recipientIds].map((authUserId) => ({
      worker_auth_user_id: authUserId, event_type: 'shift.batch_created',
      dedupe_key: `shift.gap_batch:${batchId}:${authUserId}`,
      title: `새 근무 ${rows.length}건`, body: '내 지역에 맞는 새 근무를 확인해 보세요.',
      data: { type: 'new_shift_batch', batchId, url: '/shifts' },
    })), { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (outboxError) {
      await sb.from('shifts').delete().eq('facility_id', context.facilityId).eq('generation_batch_id', batchId);
      await releasePlanUsage(sb, usageKey);
      throw new Error('워커 알림을 저장하지 못해 공고 생성을 취소했어요. 다시 시도해 주세요.');
    }
    await nudgeNotificationDispatch();
  }
  revalidatePath('/');
  revalidatePath('/operations');
  revalidatePath('/shifts');
  redirect(`/operations?notice=gaps_filled&count=${rows.length}`);
}

export async function approveWorkforceRecommendationAction(formData: FormData) {
  const context = await requireAdminContext(['owner', 'operator', 'super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  await requirePlanFeature(sb, context.facilityId, 'operations');
  const recommendationKey = formText(formData, 'recommendation_key');
  const recommendation = (await getWorkforceRecommendations(7)).find((item) => item.key === recommendationKey);
  if (!recommendation) redirect('/operations?notice=recommendation_changed');
  const { data: requirement } = await sb.from('staffing_requirements').select('*')
    .eq('id', recommendation.requirementId).eq('facility_id', context.facilityId).eq('is_active', true).maybeSingle();
  if (!requirement) throw new Error('추천 기준이 된 필요 인원 설정을 찾지 못했어요.');
  const estimatedPay = calcEstimatedShiftPay(requirement.start_time, requirement.end_time, requirement.replacement_hourly_wage);
  if (estimatedPay == null) throw new Error('대체 모집의 근무시간과 시급을 확인해 주세요.');
  const batchId = randomUUID();
  const rows = Array.from({ length: recommendation.shortage }, () => ({
    facility_id: context.facilityId, generation_batch_id: batchId,
    audience: 'public', invited_worker_id: null, required_role: requirement.required_role,
    shift_date: recommendation.date, start_time: requirement.start_time, end_time: requirement.end_time,
    hourly_wage: requirement.replacement_hourly_wage, estimated_total_pay: estimatedPay,
    description: requirement.replacement_description, department: requirement.department,
    notes: `인력 공백 추천 승인 · ${recommendation.reason}`, posted_by: context.user.id,
  }));
  const { data: created, error } = await sb.from('shifts').insert(rows).select('id');
  if (error || !created?.length) throw new Error('추천 공고를 생성하지 못했어요.');
  const usageKey = `job_posting_batch:${context.facilityId}:${batchId}`;
  try {
    await consumePlanUsage(sb, context.facilityId, 'job_posting_slot', created.length, usageKey);
  } catch (usageError) {
    await sb.from('shifts').delete().eq('facility_id', context.facilityId).eq('generation_batch_id', batchId);
    await releasePlanUsage(sb, usageKey);
    throw usageError;
  }
  const recipients = new Set<string>();
  for (const shift of created) {
    const { data, error: recipientError } = await sb.rpc('get_shift_notification_recipients', { p_shift_id: shift.id });
    if (recipientError) {
      await sb.from('shifts').delete().eq('facility_id', context.facilityId).eq('generation_batch_id', batchId);
      await releasePlanUsage(sb, usageKey);
      throw new Error('알림 대상을 확인하지 못해 추천 반영을 취소했어요.');
    }
    for (const recipient of data ?? []) if (recipient.auth_user_id) recipients.add(recipient.auth_user_id as string);
  }
  if (recipients.size) {
    const { error: outboxError } = await sb.from('notification_outbox').upsert([...recipients].map((authUserId) => ({
      worker_auth_user_id: authUserId, event_type: 'shift.staffing_recommendation',
      dedupe_key: `shift.staffing_recommendation:${batchId}:${authUserId}`,
      title: `${recommendation.department ?? '사업장'} 대체 근무가 열렸어요`,
      body: `${recommendation.date} ${recommendation.startTime.slice(0,5)} · 조건을 확인해 보세요.`,
      data: { type: 'new_shift_batch', batchId, url: '/shifts' },
    })), { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (outboxError) {
      await sb.from('shifts').delete().eq('facility_id', context.facilityId).eq('generation_batch_id', batchId);
      await releasePlanUsage(sb, usageKey);
      throw new Error('워커 알림 저장에 실패해 추천 반영을 취소했어요.');
    }
    await nudgeNotificationDispatch();
  }
  revalidatePath('/');
  revalidatePath('/operations');
  revalidatePath('/shifts');
  redirect(`/operations?notice=recommendation_applied&count=${created.length}`);
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
  const { data: workers } = await sb.rpc('get_shift_notification_recipients', { p_shift_id: target.id });
  const hourKey = new Date().toISOString().slice(0, 13);
  const outbox = (workers ?? []).filter((worker: any) => worker.auth_user_id).map((worker: any) => ({
    worker_auth_user_id: worker.auth_user_id, event_type: 'shift.urgent',
    dedupe_key: `shift.urgent:${target.id}:${hourKey}:${worker.auth_user_id}`,
    title: kind === 'no_show' ? '긴급 대체 근무 요청' : '48시간 내 긴급 시프트',
    body: `${target.shift_date} ${target.start_time.slice(0,5)} · ${target.department ?? '병동 근무'}`,
    data: { type: 'urgent_shift', shiftId: target.id },
  }));
  if (outbox.length) {
    await sb.from('notification_outbox').upsert(outbox, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    await nudgeNotificationDispatch();
  }
  revalidatePath('/operations');
  revalidatePath('/shifts');
  redirect('/operations?notice=urgent_sent');
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
  redirect('/operations?notice=template_off');
}
