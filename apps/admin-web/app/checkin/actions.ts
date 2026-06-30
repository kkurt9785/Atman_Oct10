'use server';
import { adminClient } from '@/lib/supabase';
import { ORG_ID } from '@/lib/supabase';

// 야간 시간(22:00~06:00) 분 수 계산
function calcNightMinutes(checkIn: Date, checkOut: Date): number {
  let mins = 0;
  const cur = new Date(checkIn);
  while (cur < checkOut) {
    const h = cur.getHours();
    if (h >= 22 || h < 6) mins++;
    cur.setTime(cur.getTime() + 60_000);
  }
  return mins;
}

// 법정 휴게시간 (근로기준법)
function breakMinutes(workedMins: number): number {
  if (workedMins >= 480) return 60; // 8h+ → 60분
  if (workedMins >= 240) return 30; // 4h+ → 30분
  return 0;
}

export type CheckinResult =
  | { ok: true; workerName: string; shiftDate: string; startTime: string; action: 'checkin' | 'checkout'; gross?: number }
  | { ok: false; message: string };

export async function recordCheckin(applicationId: string): Promise<CheckinResult> {
  const sb = adminClient();
  if (!sb) return { ok: false, message: '서버 오류' };

  // shift_application + shift + worker 조회
  const { data: app, error } = await sb
    .from('shift_applications')
    .select(`
      id, status,
      shifts ( id, shift_date, start_time, end_time, hourly_wage, facility_id ),
      workers ( id, name, auth_user_id )
    `)
    .eq('id', applicationId)
    .single();

  if (error || !app) return { ok: false, message: '유효하지 않은 QR이에요' };
  if (app.status !== 'accepted') return { ok: false, message: '수락된 시프트가 아니에요' };

  const shift  = app.shifts  as unknown as { id: string; shift_date: string; start_time: string; end_time: string; hourly_wage: number; facility_id: string };
  const worker = app.workers as unknown as { id: string; name: string; auth_user_id: string };

  // 기존 attendance 조회
  const { data: attendance } = await sb
    .from('shift_attendances')
    .select('id, check_in_at, check_out_at')
    .eq('application_id', applicationId)
    .maybeSingle();

  if (attendance?.check_out_at) {
    return { ok: false, message: '이미 체크아웃 완료된 시프트예요' };
  }

  const now = new Date();

  // ── 체크인 ──────────────────────────────────────
  if (!attendance) {
    await sb.from('shift_attendances').insert({
      shift_id:        shift.id,
      worker_id:       worker.id,
      application_id:  applicationId,
      check_in_at:     now.toISOString(),
      check_in_method: 'qr',
    });
    // shift_applications mirror
    await sb.from('shift_applications')
      .update({ checked_in_at: now.toISOString() })
      .eq('id', applicationId);

    return {
      ok: true,
      workerName: worker.name,
      shiftDate:  shift.shift_date,
      startTime:  shift.start_time,
      action: 'checkin',
    };
  }

  // ── 체크아웃 ────────────────────────────────────
  const checkIn  = new Date(attendance.check_in_at as string);
  const rawMins  = Math.round((now.getTime() - checkIn.getTime()) / 60_000);
  const breakMin = breakMinutes(rawMins);
  const workedMin = rawMins - breakMin;
  const nightMin  = calcNightMinutes(checkIn, now);
  const hourlyWage = shift.hourly_wage;
  const base           = Math.round((workedMin / 60) * hourlyWage);
  const nightPremium   = Math.round((nightMin  / 60) * hourlyWage * 0.5);
  const gross          = base + nightPremium;

  await sb.from('shift_attendances').update({
    check_out_at:     now.toISOString(),
    check_out_method: 'qr',
    actual_minutes:   workedMin,
  }).eq('id', attendance.id);

  // wage_calculations INSERT
  await sb.from('wage_calculations').insert({
    attendance_id:    attendance.id,
    org_id:           ORG_ID ?? shift.facility_id,
    worker_id:        worker.id,
    shift_id:         shift.id,
    rule_version:     '2026-KR',
    worked_minutes:   workedMin,
    night_minutes:    nightMin,
    overtime_minutes: 0,
    break_minutes:    breakMin,
    base,
    overtime_premium: 0,
    night_premium:    nightPremium,
    holiday_premium:  0,
    gross,
    breakdown: { hourly_wage: hourlyWage, raw_minutes: rawMins, break_minutes: breakMin },
    calculated_at: now.toISOString(),
  });

  // credit_ledger 차감 (실패해도 체크아웃은 완료 처리)
  try {
    await sb.from('credit_ledger').insert({
      org_id:     shift.facility_id,
      delta:      -gross,       // 음수 = 크레딧 차감
      kind:       'shift_wage',
      ref:        shift.id,
      created_at: now.toISOString(),
    });
  } catch (err) {
    console.error('[credit_ledger] 차감 실패 (체크아웃은 완료):', err);
  }

  // shift_applications mirror + completed
  await sb.from('shift_applications')
    .update({ checked_out_at: now.toISOString(), status: 'completed' })
    .eq('id', applicationId);

  await sb.from('shifts')
    .update({ status: 'completed' })
    .eq('id', shift.id);

  return {
    ok: true,
    workerName: worker.name,
    shiftDate:  shift.shift_date,
    startTime:  shift.start_time,
    action: 'checkout',
    gross,
  };
}
