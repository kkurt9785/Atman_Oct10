'use server';

import { redirect } from 'next/navigation';
import { createShift } from '../db/shifts';
import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { sendWebPush } from '../push';
import { calcEstimatedShiftPay, MIN_HOURLY_WAGE_2026 } from '../pay';
import type webpush from 'web-push';

const ROLE_LABEL: Record<string, string> = {
  rn: '간호사',
  na: '간호조무사',
  any: '간호인력',
};

export async function createShiftAction(formData: FormData) {
  const shiftDate = formData.get('shift_date') as string;
  const startTime = formData.get('start_time') as string;
  const endTime = formData.get('end_time') as string;
  const hourlyWage = parseInt(formData.get('hourly_wage') as string, 10);
  const requiredRole = formData.get('required_role') as 'rn' | 'na' | 'any';
  const description = (formData.get('description') as string).trim();
  const department = (formData.get('department') as string).trim() || null;
  const notes = (formData.get('notes') as string).trim() || null;

  if (!shiftDate || !startTime || !endTime || !requiredRole || !description) {
    throw new Error('필수 항목을 모두 입력해 주세요.');
  }
  if (!['rn', 'na', 'any'].includes(requiredRole)) {
    throw new Error('필요 자격이 올바르지 않습니다.');
  }
  if (isNaN(hourlyWage) || hourlyWage < MIN_HOURLY_WAGE_2026) {
    throw new Error('시급은 2026년 최저시급(9,860원) 이상이어야 합니다.');
  }
  const estimatedTotalPay = calcEstimatedShiftPay(startTime, endTime, hourlyWage);
  if (estimatedTotalPay == null) {
    throw new Error('근무 시간을 확인해 주세요.');
  }

  await createShift({
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

  // Web Push 알림 발송 — 실패해도 시프트 등록은 완료됨
  try {
    const sb = adminClient();
    if (sb) {
      const roleFilter = requiredRole === 'any' ? ['rn', 'na'] : [requiredRole];

      // 매칭 역할의 승인 워커 auth user ID 조회
      const { data: workers } = await sb
        .from('workers')
        .select('auth_user_id')
        .in('role', roleFilter)
        .eq('verification_status', 'approved')
        .is('deleted_at', null);

      if (workers && workers.length > 0) {
        const ids = workers
          .map((w: { auth_user_id: string | null }) => w.auth_user_id)
          .filter(Boolean) as string[];

        // Web Push 구독 조회
        const { data: subs } = await sb
          .from('push_subscriptions')
          .select('subscription')
          .in('worker_id', ids);

        if (subs && subs.length > 0) {
          const payLabel = estimatedTotalPay.toLocaleString('ko-KR') + '원';
          const timeLabel = `${startTime.slice(0, 5)}~${endTime.slice(0, 5)}`;
          const payload = {
            title: `새 시프트 공고 — ${ROLE_LABEL[requiredRole]}`,
            body: `${shiftDate} ${timeLabel} · ${payLabel}`,
            data: { type: 'new_shift' },
          };

          await Promise.all(
            subs.map((row: { subscription: webpush.PushSubscription }) =>
              sendWebPush(row.subscription, payload)
            )
          );
        }
      }
    }
  } catch (err) {
    console.error('[push] 알림 발송 실패:', err);
  }

  redirect('/shifts');
}

export async function cancelShiftAction(shiftId: string) {
  const sb = adminClient();
  const facilityId = await getCurrentFacilityId();
  if (!sb || !facilityId) throw new Error('인증 필요');

  const { data, error } = await sb
    .from('shifts')
    .update({ status: 'cancelled' })
    .eq('id', shiftId)
    .eq('facility_id', facilityId)
    .in('status', ['open', 'matched'])
    .select('id')
    .maybeSingle();

  if (error || !data) throw new Error('취소할 수 없는 시프트예요.');

  redirect('/shifts');
}
