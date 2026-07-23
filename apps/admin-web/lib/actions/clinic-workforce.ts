'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminContext } from '../admin-auth';
import { adminClient, userClient } from '../supabase';
import { todayKST } from '../date';
import { requireStaffCapacity } from '../billing-gates';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

export async function addClinicStaffAction(form: FormData) {
  const context = await requireAdminContext(['owner','operator','super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const name = text(form, 'name');
  const role = text(form, 'role');
  const engagementType = text(form, 'engagement_type');
  const contractStart = text(form, 'contract_start') || null;
  const contractEnd = text(form, 'contract_end') || null;
  const phone = text(form, 'phone') || null;
  if (!name || !['rn','na','coordinator','admin','other'].includes(role)) throw new Error('직원 이름과 직종을 확인해 주세요.');
  if (!['regular','fixed_term','temporary','daily'].includes(engagementType)) throw new Error('근무 형태를 확인해 주세요.');
  await requireStaffCapacity(sb, context.facilityId);
  const { data: linkedWorker } = phone
    ? await sb.from('workers').select('id').eq('phone', phone).is('deleted_at', null).limit(1).maybeSingle()
    : { data: null };
  const { error } = await sb.from('facility_staff').insert({
    facility_id: context.facilityId, worker_id: linkedWorker?.id ?? null, name, phone,
    role, department: text(form, 'department') || null, source: 'direct',
    engagement_type: engagementType, contract_start: contractStart, contract_end: contractEnd,
    default_start_time: text(form, 'default_start_time') || '09:00',
    default_end_time: text(form, 'default_end_time') || '18:00',
    default_break_minutes: Number(text(form, 'default_break_minutes')) || 60,
    created_by: context.user.id,
  });
  if (error) throw new Error('직원을 등록하지 못했어요.');
  revalidatePath('/staff'); revalidatePath('/timesheet');
}

export async function recordStaffAttendanceAction(form: FormData) {
  const context = await requireAdminContext(['owner','operator','super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const staffId = text(form, 'staff_id');
  const event = text(form, 'event');
  if (!['check_in','check_out','absent'].includes(event)) throw new Error('근태 처리 유형이 올바르지 않아요.');
  const { data: staff } = await sb.from('facility_staff').select('id,default_start_time,default_end_time')
    .eq('id', staffId).eq('facility_id', context.facilityId).eq('status', 'active').maybeSingle();
  if (!staff) throw new Error('근태 처리할 직원을 찾지 못했어요.');
  const now = new Date().toISOString();
  const base: Record<string, unknown> = {
    facility_id: context.facilityId, staff_id: staffId, work_date: todayKST(),
    scheduled_start: staff.default_start_time, scheduled_end: staff.default_end_time,
    corrected_by: context.user.id, correction_reason: '병원 관리자 간편 근태 처리', updated_at: now,
  };
  if (event === 'check_in') Object.assign(base, { check_in_at: now, status: 'working' });
  if (event === 'check_out') Object.assign(base, { check_out_at: now, status: 'completed' });
  if (event === 'absent') Object.assign(base, { status: 'absent' });
  const { error } = await sb.from('staff_attendances').upsert(base, { onConflict: 'staff_id,work_date' });
  if (error) throw new Error('근태를 저장하지 못했어요.');
  revalidatePath('/timesheet'); revalidatePath('/staff'); revalidatePath('/');
}

export async function addStaffLeaveAction(form: FormData) {
  const context = await requireAdminContext(['owner','operator','super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const staffId = text(form, 'staff_id');
  const startDate = text(form, 'start_date');
  const endDate = text(form, 'end_date') || startDate;
  const leaveType = text(form, 'leave_type') || 'annual';
  const hourlyMinutes = Number(text(form, 'hourly_minutes'));
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const calendarDays = Number.isFinite(startMs) && Number.isFinite(endMs)
    ? Math.floor((endMs - startMs) / 86_400_000) + 1 : 0;
  let minutes = calendarDays * 480;
  if (leaveType === 'half_day') minutes = 240;
  if (leaveType === 'quarter_day') minutes = 120;
  if (leaveType === 'hourly') minutes = hourlyMinutes;
  const { data: staff } = await sb.from('facility_staff').select('id').eq('id', staffId)
    .eq('facility_id', context.facilityId).neq('status', 'ended').maybeSingle();
  if (!staff || !startDate || endDate < startDate || !Number.isFinite(minutes) || minutes <= 0) throw new Error('휴가 정보를 확인해 주세요.');
  if (['half_day','quarter_day','hourly'].includes(leaveType) && endDate !== startDate) {
    throw new Error('반차·반반차·시간차는 하루만 선택해 주세요.');
  }
  if (leaveType === 'hourly' && (minutes < 60 || minutes > 420 || minutes % 60 !== 0)) {
    throw new Error('시간차는 1시간 단위로 1~7시간까지 사용할 수 있어요.');
  }
  const { data: created, error } = await sb.from('staff_leave_requests').insert({
    facility_id: context.facilityId, staff_id: staffId, leave_type: leaveType,
    start_date: startDate, end_date: endDate, requested_minutes: minutes,
    reason: text(form, 'reason') || null, status: 'approved',
    decided_by: context.user.id, decided_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error('휴가를 등록하지 못했어요.');
  const deductsBalance = ['annual','half_day','quarter_day','hourly'].includes(leaveType);
  if (!deductsBalance) {
    revalidatePath('/leave'); revalidatePath('/timesheet');
    return;
  }
  const year = Number(startDate.slice(0, 4));
  const { data: balance } = await sb.from('staff_leave_balances').select('used_minutes,granted_minutes')
    .eq('staff_id', staffId).eq('leave_year', year).maybeSingle();
  if (!balance || Number(balance.granted_minutes) - Number(balance.used_minutes) < minutes) {
    await sb.from('staff_leave_requests').delete().eq('id', created.id);
    throw new Error('잔여 휴가가 부족해 등록할 수 없어요.');
  }
  const { error: balanceError } = await sb.from('staff_leave_balances').upsert({
    facility_id: context.facilityId, staff_id: staffId, leave_year: year,
    granted_minutes: balance.granted_minutes,
    used_minutes: balance.used_minutes + minutes, updated_at: new Date().toISOString(),
  }, { onConflict: 'staff_id,leave_year' });
  if (balanceError) {
    await sb.from('staff_leave_requests').delete().eq('id', created.id);
    throw new Error('휴가 잔여시간을 반영하지 못했어요.');
  }
  revalidatePath('/leave'); revalidatePath('/timesheet');
}

export async function setStaffLeaveBalanceAction(form: FormData) {
  const context = await requireAdminContext(['owner','operator','super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const staffId = text(form, 'staff_id');
  const grantedDays = Number(text(form, 'granted_days'));
  const year = Number(text(form, 'leave_year')) || Number(todayKST().slice(0,4));
  if (!staffId || !Number.isFinite(grantedDays) || grantedDays < 0 || grantedDays > 365) throw new Error('휴가 부여일수를 확인해 주세요.');
  const { data: staff } = await sb.from('facility_staff').select('id').eq('id', staffId)
    .eq('facility_id', context.facilityId).neq('status', 'ended').maybeSingle();
  if (!staff) throw new Error('직원을 찾지 못했어요.');
  const { data: existing } = await sb.from('staff_leave_balances').select('used_minutes')
    .eq('staff_id', staffId).eq('leave_year', year).maybeSingle();
  const { error } = await sb.from('staff_leave_balances').upsert({
    facility_id: context.facilityId, staff_id: staffId, leave_year: year,
    granted_minutes: Math.round(grantedDays * 480), used_minutes: existing?.used_minutes ?? 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'staff_id,leave_year' });
  if (error) throw new Error('휴가 부여일수를 저장하지 못했어요.');
  revalidatePath('/leave'); revalidatePath('/staff');
}

export async function decideStaffLeaveAction(form: FormData) {
  const context = await requireAdminContext(['owner','operator','super']);
  const sb = userClient(context.accessToken);
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const requestId = text(form, 'request_id');
  const decision = text(form, 'decision');
  if (!['approved','rejected'].includes(decision)) throw new Error('승인 여부를 확인해 주세요.');
  const { error } = await sb.rpc('decide_staff_leave_request', { p_request_id: requestId, p_decision: decision });
  if (error) throw new Error('휴가 신청을 처리하지 못했어요.');
  revalidatePath('/leave'); revalidatePath('/timesheet');
}

export async function decideEarlyCheckoutAction(form: FormData) {
  const context = await requireAdminContext(['owner','operator','super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const staffId = text(form, 'staff_id');
  const decision = text(form, 'decision');
  if (!['approved','rejected'].includes(decision)) throw new Error('승인 여부를 확인해 주세요.');
  const { data: attendance } = await sb.from('staff_attendances')
    .select('id,checkout_requested_at').eq('facility_id', context.facilityId).eq('staff_id', staffId)
    .eq('work_date', todayKST()).eq('status', 'checkout_pending').maybeSingle();
  if (!attendance?.checkout_requested_at) throw new Error('처리할 조기 퇴근 요청이 없어요.');
  const patch = decision === 'approved'
    ? { check_out_at: attendance.checkout_requested_at, status: 'completed', corrected_by: context.user.id, correction_reason: '관리자 조기 퇴근 승인', updated_at: new Date().toISOString() }
    : { checkout_requested_at: null, status: 'working', corrected_by: context.user.id, correction_reason: '관리자 조기 퇴근 반려', updated_at: new Date().toISOString() };
  const { error } = await sb.from('staff_attendances').update(patch).eq('id', attendance.id);
  if (error) throw new Error('조기 퇴근 요청을 처리하지 못했어요.');
  revalidatePath('/timesheet'); revalidatePath('/staff'); revalidatePath('/');
}

export async function rotateFacilityAttendanceQrAction() {
  const context = await requireAdminContext(['owner','operator','super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const { error } = await sb.from('facility_attendance_qr').upsert({
    facility_id: context.facilityId, token: crypto.randomUUID(), is_active: true,
    rotated_at: new Date().toISOString(), rotated_by: context.user.id,
  }, { onConflict: 'facility_id' });
  if (error) throw new Error('병원 QR을 갱신하지 못했어요.');
  revalidatePath('/attendance-qr');
}

export async function convertMatchedWorkerToStaffAction(form: FormData) {
  const context = await requireAdminContext(['owner','operator','super']);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const workerId = text(form, 'worker_id');
  const { data: worker } = await sb.from('workers').select('id,name,phone,role')
    .eq('id', workerId).is('deleted_at', null).maybeSingle();
  if (!worker) throw new Error('전환할 지원자 정보를 찾지 못했어요.');
  const { data: existing } = await sb.from('facility_staff').select('id')
    .eq('facility_id', context.facilityId).eq('worker_id', worker.id).maybeSingle();
  if (existing) return;
  await requireStaffCapacity(sb, context.facilityId);
  const role = worker.role === 'rn' || worker.role === 'na' ? worker.role : 'other';
  const { error } = await sb.from('facility_staff').insert({
    facility_id: context.facilityId, worker_id: worker.id, name: worker.name,
    phone: worker.phone ?? null, role, source: 'atman', engagement_type: 'temporary',
    default_start_time: text(form, 'default_start_time') || '09:00',
    default_end_time: text(form, 'default_end_time') || '18:00',
    default_break_minutes: 60, created_by: context.user.id,
  });
  if (error) throw new Error('직원으로 전환하지 못했어요.');
  revalidatePath('/staff'); revalidatePath('/timesheet');
}
