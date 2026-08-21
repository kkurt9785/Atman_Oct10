'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdminContext } from '@/lib/admin-auth';
import { todayKST } from '@/lib/date';
import { isLiveDemoFacility, isLiveDemoShift } from '@/lib/live-demo';
import { nudgeNotificationDispatch } from '@/lib/notify-nudge';
import { adminClient, userClient } from '@/lib/supabase';
import { recordShiftAdminAttendanceAction } from '@/lib/actions/clinic-workforce';

type LiveDemoContext = {
  context: Awaited<ReturnType<typeof requireAdminContext>>;
  sb: NonNullable<ReturnType<typeof adminClient>>;
};

async function requireLiveDemoContext(roles: Parameters<typeof requireAdminContext>[0]): Promise<LiveDemoContext> {
  const context = await requireAdminContext(roles);
  const sb = adminClient();
  if (!sb) throw new Error('서버 설정을 확인해 주세요.');
  const { data: facility, error } = await sb.from('facilities')
    .select('id,is_demo,business_registration_number')
    .eq('id', context.facilityId)
    .maybeSingle();
  if (error || !isLiveDemoFacility(facility)) {
    throw new Error('현장 시연은 지정된 데모 사업장에서만 사용할 수 있어요.');
  }
  return { context, sb };
}

async function requireLiveDemoApplication(
  sb: NonNullable<ReturnType<typeof adminClient>>,
  facilityId: string,
  applicationId: string,
) {
  if (!applicationId) throw new Error('시연 지원 정보를 찾지 못했어요.');
  const { data: application, error } = await sb.from('shift_applications')
    .select('id,status,worker_id,shift_id,credential_review_status,shifts!inner(facility_id,notes)')
    .eq('id', applicationId)
    .eq('shifts.facility_id', facilityId)
    .maybeSingle();
  const shift = Array.isArray((application as any)?.shifts) ? (application as any).shifts[0] : (application as any)?.shifts;
  if (error || !application || !isLiveDemoShift(shift?.notes)) {
    throw new Error('현장 시연용 지원 건만 처리할 수 있어요.');
  }
  return application;
}

function refreshLiveDemo() {
  revalidatePath('/live-demo');
  revalidatePath('/');
  revalidatePath('/applications');
  revalidatePath('/chats');
  revalidatePath('/timesheet');
  revalidatePath('/payroll');
  revalidatePath('/shifts');
}

function liveDemoWindow() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const minute = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const start = Math.max(0, minute - 15);
  const end = start + 60;
  const time = (value: number) => `${String(Math.floor((value % 1440) / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return { startTime: time(start), endTime: time(end), isOvernight: end >= 1440 };
}

/**
 * This is intentionally available only to the three seeded demo facilities.
 * It makes a same-day, open demo shift; it never changes the normal shift
 * creation, acceptance, attendance or payroll paths used by subscribers.
 */
export async function prepareLiveDemoAction() {
  const { context, sb } = await requireLiveDemoContext(['owner', 'operator', 'super']);
  const { error: resetError } = await sb.rpc('reset_three_facility_live_demo', {
    p_facility_id: context.facilityId,
  });
  if (resetError) throw new Error('시연 공고를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.');

  const { data: shifts, error: shiftError } = await sb.from('shifts')
    .select('id,notes,shift_date,start_time,department,hourly_wage')
    .eq('facility_id', context.facilityId)
    .like('notes', 'LIVE-SALES-DEMO-%')
    .eq('status', 'open');
  const ids = (shifts ?? []).filter((shift) => isLiveDemoShift(shift.notes)).map((shift) => shift.id);
  if (shiftError || !ids.length) throw new Error('시연용 공고를 찾지 못했어요. 데모 시드를 확인해 주세요.');

  // A live demo must work at the counter now. The one-hour window admits both
  // GPS check-in and check-out immediately, but uses the same normal server
  // time checks and attendance state machine as a subscriber's shift.
  const window = liveDemoWindow();
  for (const shift of shifts ?? []) {
    const { error: timingError } = await sb.from('shifts').update({
      shift_date: todayKST(), start_time: window.startTime, end_time: window.endTime,
      is_overnight: window.isOvernight, estimated_total_pay: Number(shift.hourly_wage),
      updated_at: new Date().toISOString(),
    }).eq('id', shift.id).eq('facility_id', context.facilityId);
    if (timingError) throw new Error('시연 공고 시간을 지금으로 맞추지 못했어요.');
  }

  // Unlike the normal operations reset, this hidden page is used at a sales
  // meeting. Create a fresh, direct-to-shift event only for matching demo
  // workers so the worker device can open the exact newly-created job.
  const outbox: Array<Record<string, unknown>> = [];
  for (const shift of shifts ?? []) {
    const { data: recipients, error: recipientError } = await sb.rpc('get_shift_notification_recipients', {
      p_shift_id: shift.id,
    });
    if (recipientError) throw new Error('시연 워커 알림 대상을 확인하지 못했어요.');
    for (const recipient of recipients ?? []) {
      if (!recipient.auth_user_id) continue;
      outbox.push({
        worker_auth_user_id: recipient.auth_user_id,
        event_type: 'shift.live_demo_ready',
        dedupe_key: `shift.live_demo_ready:${shift.id}:${recipient.auth_user_id}`,
        title: '지금 지원해 볼 시연 근무가 열렸어요',
        body: `${todayKST()} ${window.startTime} · ${shift.department ?? '현장 근무'}`,
        data: { type: 'new_shift', shiftId: shift.id, url: `/shifts?highlight=${shift.id}` },
      });
    }
  }
  if (outbox.length) {
    const { error: outboxError } = await sb.from('notification_outbox')
      .upsert(outbox, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (outboxError) throw new Error('시연 공고는 만들었지만 워커 알림을 저장하지 못했어요.');
    await nudgeNotificationDispatch();
  }

  refreshLiveDemo();
  redirect('/live-demo?notice=ready');
}

export async function anchorLiveDemoLocationAction(input: { latitude: number; longitude: number; accuracy: number | null }) {
  const { context } = await requireLiveDemoContext(['owner', 'operator', 'super']);
  const latitude = Number(input?.latitude);
  const longitude = Number(input?.longitude);
  const accuracy = input?.accuracy == null ? null : Number(input.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error('현재 위치를 다시 확인해 주세요.');
  }
  if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 5000)) {
    throw new Error('현재 위치 정확도를 확인해 주세요.');
  }
  const userSb = userClient(context.accessToken);
  if (!userSb) throw new Error('서버 설정을 확인해 주세요.');
  const { data, error } = await userSb.rpc('set_live_demo_attendance_location', {
    p_facility_id: context.facilityId, p_lat: latitude, p_lng: longitude, p_accuracy: accuracy,
  });
  if (error) throw new Error(error.message || '시연 위치를 저장하지 못했어요.');
  refreshLiveDemo();
  return data as { ok: boolean; radiusM: number };
}

export async function acceptLiveDemoApplicationAction(formData: FormData) {
  const { context, sb } = await requireLiveDemoContext(['owner', 'operator', 'super']);
  const applicationId = String(formData.get('application_id') ?? '').trim();
  const application = await requireLiveDemoApplication(sb, context.facilityId, applicationId);
  if (application.status !== 'applied') throw new Error('워커가 지원한 뒤에 수락할 수 있어요.');

  const userSb = userClient(context.accessToken);
  if (!userSb) throw new Error('서버 설정을 확인해 주세요.');
  const { error } = await userSb.rpc('accept_shift_application', { p_application_id: applicationId });
  if (error) throw new Error(error.message || '시연 지원을 수락하지 못했어요.');
  await nudgeNotificationDispatch();
  refreshLiveDemo();
  redirect('/live-demo?notice=accepted');
}

export async function recordLiveDemoAttendanceAction(formData: FormData) {
  const { context, sb } = await requireLiveDemoContext(['owner', 'operator', 'super']);
  const applicationId = String(formData.get('application_id') ?? '').trim();
  const event = String(formData.get('event') ?? '').trim();
  if (event !== 'check_in' && event !== 'check_out') throw new Error('출퇴근 처리 유형이 올바르지 않아요.');
  await requireLiveDemoApplication(sb, context.facilityId, applicationId);
  await recordShiftAdminAttendanceAction(formData);
  refreshLiveDemo();
  redirect(`/live-demo?notice=${event === 'check_in' ? 'checked_in' : 'checked_out'}`);
}

export async function markLiveDemoPaymentPaidAction(formData: FormData) {
  const { context, sb } = await requireLiveDemoContext(['owner', 'super']);
  if (!context.canViewPayroll) throw new Error('급여 처리 권한이 없습니다.');
  const instructionId = String(formData.get('instruction_id') ?? '').trim();
  if (!instructionId) throw new Error('지급 요청을 찾지 못했어요.');
  const { data: payment, error: paymentError } = await sb.from('wage_payment_instructions')
    .select('id,status,worker_id,shift_id,shifts!inner(facility_id,notes)')
    .eq('id', instructionId)
    .eq('facility_id', context.facilityId)
    .maybeSingle();
  const shift = Array.isArray((payment as any)?.shifts) ? (payment as any).shifts[0] : (payment as any)?.shifts;
  if (paymentError || !payment || !isLiveDemoShift(shift?.notes)) {
    throw new Error('현장 시연으로 생성된 지급 요청만 처리할 수 있어요.');
  }
  if (payment.status === 'paid' || payment.status === 'worker_confirmed') {
    refreshLiveDemo();
    redirect('/live-demo?notice=paid');
  }
  if (payment.status === 'disputed' || payment.status === 'cancelled') throw new Error('현재 상태의 지급 요청은 시연 완료 처리할 수 없어요.');

  const userSb = userClient(context.accessToken);
  if (!userSb) throw new Error('서버 설정을 확인해 주세요.');
  let status = payment.status;
  for (const action of ['approve', 'mark_exported', 'mark_paid'] as const) {
    if ((action === 'approve' && status !== 'draft')
      || (action === 'mark_exported' && status !== 'approved')
      || (action === 'mark_paid' && status !== 'exported')) continue;
    const { data: updated, error } = await userSb.rpc('update_wage_payment_status', {
      p_instruction_id: instructionId,
      p_action: action,
      p_payment_reference: 'LIVE-DEMO',
      p_dispute_reason: null,
    });
    if (error) throw new Error(error.message || '지급 상태를 변경하지 못했어요.');
    status = (updated as { status?: string } | null)?.status ?? status;
  }
  if (status !== 'paid') throw new Error('지급 완료 상태로 바꾸지 못했어요.');

  const { data: worker } = await sb.from('workers').select('auth_user_id,name').eq('id', payment.worker_id).maybeSingle();
  if (worker?.auth_user_id) {
    const { error: outboxError } = await sb.from('notification_outbox').upsert({
      worker_auth_user_id: worker.auth_user_id,
      event_type: 'payment.paid',
      dedupe_key: `payment.paid:${instructionId}`,
      title: '지급 완료로 표시됐어요',
      body: `${worker.name ?? '워커'}님 근무 건의 지급 완료를 확인해 주세요.`,
      data: { url: '/store/credits', paymentInstructionId: instructionId, shiftId: payment.shift_id },
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (outboxError) throw new Error('지급 완료 알림을 저장하지 못했어요.');
    await nudgeNotificationDispatch();
  }
  refreshLiveDemo();
  redirect('/live-demo?notice=paid');
}
