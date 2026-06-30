'use server';
import { revalidatePath } from 'next/cache';
import { adminClient } from '@/lib/supabase';
import { sendWebPush } from '@/lib/push';
import type webpush from 'web-push';

export async function acceptApplication(
  applicationId: string,
  shiftId: string,
  workerId: string,
) {
  const sb = adminClient();
  if (!sb) return;

  const now = new Date().toISOString();

  // 수락 + 시프트 매칭
  await Promise.all([
    sb.from('shift_applications')
      .update({ status: 'accepted', responded_at: now })
      .eq('id', applicationId),
    sb.from('shifts')
      .update({ status: 'matched', matched_worker_id: workerId, matched_at: now })
      .eq('id', shiftId),
  ]);

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
  if (!sb) return;

  await sb.from('shift_applications')
    .update({ status: 'rejected', responded_at: new Date().toISOString() })
    .eq('id', applicationId);

  revalidatePath('/applications');
  revalidatePath('/');
}
