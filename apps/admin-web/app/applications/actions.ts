'use server';
import { revalidatePath } from 'next/cache';
import { adminClient } from '@/lib/supabase';
import { requireFacilityAdmin } from '@/lib/facility';
import { sendWebPush } from '@/lib/push';
import type webpush from 'web-push';

export async function acceptApplication(
  applicationId: string,
  shiftId: string,
  workerId: string,
) {
  const sb = adminClient();
  const session = await requireFacilityAdmin();
  if (!sb || !session) throw new Error('인증 필요');
  const facilityId = session.facilityId;

  const now = new Date().toISOString();

  const { data: app } = await sb
    .from('shift_applications')
    .select('id, shift_id, worker_id, status, shifts ( id, facility_id, status )')
    .eq('id', applicationId)
    .maybeSingle();

  const shift = app?.shifts as unknown as { id: string; facility_id: string; status: string } | null;
  if (
    !app ||
    !shift ||
    app.shift_id !== shiftId ||
    app.worker_id !== workerId ||
    app.status !== 'applied' ||
    shift.facility_id !== facilityId ||
    shift.status !== 'open'
  ) {
    throw new Error('수락할 수 없는 지원이에요.');
  }

  const { data: matchedShift, error: matchError } = await sb.from('shifts')
    .update({ status: 'matched', matched_worker_id: workerId, matched_at: now })
    .eq('id', shiftId)
    .eq('facility_id', facilityId)
    .eq('status', 'open')
    .select('id')
    .maybeSingle();

  if (matchError || !matchedShift) throw new Error('이미 처리된 시프트예요.');

  const { error: acceptError } = await sb.from('shift_applications')
    .update({ status: 'accepted', responded_at: now })
    .eq('id', applicationId)
    .eq('shift_id', shiftId)
    .eq('worker_id', workerId)
    .eq('status', 'applied');

  if (acceptError) throw new Error('지원 수락에 실패했어요.');

  // 나머지 지원자 자동 거절
  await sb.from('shift_applications')
    .update({ status: 'rejected', responded_at: now })
    .eq('shift_id', shiftId)
    .neq('id', applicationId)
    .eq('status', 'applied');

  // 수락 알림 발송 (실패해도 수락은 완료)
  try {
    const [{ data: worker }, { data: shift }] = await Promise.all([
      sb.from('workers').select('auth_user_id').eq('id', workerId).single(),
      sb.from('shifts').select('shift_date, start_time, end_time, estimated_total_pay').eq('id', shiftId).single(),
    ]);

    if (worker?.auth_user_id) {
      const { data: subRow } = await sb
        .from('push_subscriptions')
        .select('subscription')
        .eq('worker_id', worker.auth_user_id)
        .maybeSingle();

      if (subRow?.subscription && shift) {
        const pay = (shift.estimated_total_pay as number).toLocaleString('ko-KR');
        const time = `${(shift.start_time as string).slice(0, 5)}~${(shift.end_time as string).slice(0, 5)}`;
        await sendWebPush(subRow.subscription as webpush.PushSubscription, {
          title: '🎉 시프트 수락됐어요!',
          body: `${shift.shift_date} ${time} · ₩${pay}`,
          data: { type: 'accepted', applicationId },
        });
      }
    }
  } catch (err) {
    console.error('[push] 수락 알림 실패:', err);
  }

  revalidatePath('/applications');
  revalidatePath('/');
}

export async function rejectApplication(applicationId: string) {
  const sb = adminClient();
  const session = await requireFacilityAdmin();
  if (!sb || !session) throw new Error('인증 필요');
  const facilityId = session.facilityId;

  const { data: app } = await sb
    .from('shift_applications')
    .select('id, status, shifts ( facility_id )')
    .eq('id', applicationId)
    .maybeSingle();

  const shift = app?.shifts as unknown as { facility_id: string } | null;
  if (!app || !shift || shift.facility_id !== facilityId || app.status !== 'applied') {
    throw new Error('거절할 수 없는 지원이에요.');
  }

  await sb.from('shift_applications')
    .update({ status: 'rejected', responded_at: new Date().toISOString() })
    .eq('id', applicationId)
    .eq('status', 'applied');

  revalidatePath('/applications');
  revalidatePath('/');
}
