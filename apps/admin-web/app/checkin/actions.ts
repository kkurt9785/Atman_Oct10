'use server';
import { adminClient } from '@/lib/supabase';
import { getCurrentFacilityId } from '@/lib/facility';
import { calcBreakMinutes } from '@/lib/pay';
import { todayKST } from '@/lib/date';

// 야간 시간(KST 22:00~06:00) 분 수 계산 — 서버 TZ(UTC)와 무관하게 KST로 판정
function calcNightMinutes(checkIn: Date, checkOut: Date): number {
  let mins = 0;
  const cur = new Date(checkIn);
  while (cur < checkOut) {
    const kstHour = new Date(cur.getTime() + 9 * 60 * 60_000).getUTCHours();
    if (kstHour >= 22 || kstHour < 6) mins++;
    cur.setTime(cur.getTime() + 60_000);
  }
  return mins;
}

export type CheckinResult =
  | { ok: true; workerName: string; shiftDate: string; startTime: string; action: 'checkin' | 'checkout'; gross?: number }
  | { ok: false; message: string };

export async function recordCheckin(applicationId: string): Promise<CheckinResult> {
  const sb = adminClient();
  const facilityId = await getCurrentFacilityId();
  if (!sb || !facilityId) return { ok: false, message: '인증이 필요해요' };

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
  if (shift.facility_id !== facilityId) return { ok: false, message: '이 병원의 시프트가 아니에요' };

  const today = todayKST();

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
    // 체크인은 당일(KST)만 허용
    if (shift.shift_date !== today) {
      const diff = Math.ceil(
        (new Date(shift.shift_date).getTime() - new Date(today).getTime()) / 86400000
      );
      const msg = diff > 0 ? `${diff}일 후 시프트예요` : '이미 지난 시프트예요';
      return { ok: false, message: msg };
    }
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
  const checkIn   = new Date(attendance.check_in_at as string);
  const rawMins   = Math.max(0, Math.round((now.getTime() - checkIn.getTime()) / 60_000)); // 시계 역전 방어
  const breakMin  = calcBreakMinutes(rawMins);
  const workedMin = Math.max(0, rawMins - breakMin);
  const nightMin  = Math.min(calcNightMinutes(checkIn, now), workedMin);
  const overtimeMin = Math.max(0, workedMin - 8 * 60); // 1일 8h 초과 = 연장
  const hourlyWage  = shift.hourly_wage;
  const perMin = hourlyWage / 60;
  const base            = Math.round(workedMin * perMin);
  const overtimePremium = Math.round(overtimeMin * perMin * 0.5); // 연장 +50%
  const nightPremium    = Math.round(nightMin * perMin * 0.5);    // 야간 +50%
  const holidayPremium  = 0; // 휴일 가산: shifts 휴일 플래그 필요 → 후속(데이터 추가)
  const gross = base + overtimePremium + nightPremium + holidayPremium;

  // 순서: 금액 기록 → 크레딧 차감 → (여기서부터 재스캔 차단) 출퇴근 확정 → 미러.
  // wage_calculations UNIQUE(attendance_id) / credit_ledger UNIQUE(org_id,ref) 로 재시도 안전.
  const { error: wageErr } = await sb.from('wage_calculations').insert({
    attendance_id:    attendance.id,
    org_id:           facilityId,
    worker_id:        worker.id,
    shift_id:         shift.id,
    rule_version:     '2026-KR',
    worked_minutes:   workedMin,
    night_minutes:    nightMin,
    overtime_minutes: overtimeMin,
    break_minutes:    breakMin,
    base,
    overtime_premium: overtimePremium,
    night_premium:    nightPremium,
    holiday_premium:  holidayPremium,
    gross,
    breakdown: { hourly_wage: hourlyWage, raw_minutes: rawMins, break_minutes: breakMin },
    calculated_at: now.toISOString(),
  });
  if (wageErr && wageErr.code !== '23505') return { ok: false, message: '정산 기록에 실패했어요. 다시 시도해 주세요.' };

  const { error: creditErr } = await sb.from('credit_ledger').insert({
    org_id:     shift.facility_id,
    delta:      -gross,       // 음수 = 크레딧 차감
    kind:       'spend',
    ref:        shift.id,
    created_at: now.toISOString(),
  });
  if (creditErr && creditErr.code !== '23505') return { ok: false, message: '크레딧 차감에 실패했어요. 다시 시도해 주세요.' };

  // 출퇴근 확정 (actual_minutes 는 GENERATED 컬럼이라 write 하지 않음)
  const { error: attErr } = await sb.from('shift_attendances').update({
    check_out_at:     now.toISOString(),
    check_out_method: 'qr',
  }).eq('id', attendance.id);
  if (attErr) return { ok: false, message: '체크아웃 저장에 실패했어요. 다시 시도해 주세요.' };

  // 미러(표시용) — best-effort
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
