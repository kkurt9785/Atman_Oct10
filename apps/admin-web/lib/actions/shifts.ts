'use server';

import { redirect } from 'next/navigation';
import { createShift } from '../db/shifts';
import { adminClient, ORG_ID } from '../supabase';

const ROLE_LABEL: Record<string, string> = {
  rn: '간호사',
  na: '간호조무사',
  any: '간호인력',
};

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

async function sendExpoPush(messages: ExpoMessage[]) {
  if (messages.length === 0) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch {
    // 푸시 실패는 시프트 등록에 영향 없음 — 로그만 남김
    console.error('[push] Expo 발송 실패');
  }
}

export async function createShiftAction(formData: FormData) {
  const shiftDate = formData.get('shift_date') as string;
  const startTime = formData.get('start_time') as string;
  const endTime = formData.get('end_time') as string;
  const hourlyWage = parseInt(formData.get('hourly_wage') as string, 10);
  const estimatedTotalPay = parseInt(formData.get('estimated_total_pay') as string, 10);
  const requiredRole = formData.get('required_role') as 'rn' | 'na' | 'any';
  const description = (formData.get('description') as string).trim();
  const department = (formData.get('department') as string).trim() || null;
  const notes = (formData.get('notes') as string).trim() || null;

  if (!shiftDate || !startTime || !endTime || !requiredRole || !description) {
    throw new Error('필수 항목을 모두 입력해 주세요.');
  }
  if (isNaN(hourlyWage) || hourlyWage < 9860) {
    throw new Error('시급은 2026년 최저시급(9,860원) 이상이어야 합니다.');
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

  // 주변 워커 조회 후 푸시 알림 발송 (실패해도 shift 등록은 완료)
  const sb = adminClient();
  if (sb && ORG_ID) {
    const { data: fac } = await sb
      .from('facilities')
      .select('location')
      .eq('id', ORG_ID)
      .single();

    if (fac?.location) {
      const { data: workers } = await sb.rpc('find_workers_in_radius', {
        p_facility_location: fac.location,
        p_required_role: requiredRole,
      });

      const tokens = ((workers ?? []) as { expo_token: string | null }[])
        .map((w) => w.expo_token)
        .filter((t): t is string => Boolean(t));

      const payLabel = estimatedTotalPay.toLocaleString('ko-KR') + '원';
      const timeLabel = `${startTime.slice(0, 5)}~${endTime.slice(0, 5)}`;

      await sendExpoPush(
        tokens.map((token) => ({
          to: token,
          title: `새 시프트 공고 — ${ROLE_LABEL[requiredRole]}`,
          body: `${shiftDate} ${timeLabel} · ${payLabel}`,
          data: { type: 'new_shift' },
        }))
      );
    }
  }

  redirect('/shifts');
}
