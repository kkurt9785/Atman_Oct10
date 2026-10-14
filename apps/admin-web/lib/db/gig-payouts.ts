import { adminClient, userClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { currentWeekRangeKST } from '../pay';

// 긱워커 지급 보드. 근무자별로 '마지막 지급 이후 완료된 근무'를 묶어 금액을 계산한다.
// 하루가 끝나면 그날 것만, 일주일 뒤면 일주일치가 한 건으로 잡힌다. 실제 이체는 관리자가 하고 여기엔 기록만 남는다.

export type GigPayout = {
  id: string; staffId: string; periodStart: string; periodEnd: string; workedMinutes: number; workedDays: number;
  payBasis: string; payRate: number; amount: number; withholdingRate: number; withholdingAmount: number; netAmount: number;
  status: 'scheduled' | 'paid' | 'cancelled'; payAt: string | null; paidAt: string | null; note: string | null; createdAt: string;
  /** 이 지급에 포함된 마지막 퇴근 시각 — 다음 지급은 이 시각 이후 완료분부터 */
  coveredUntil: string | null;
  /** 근무자 입금 확인(received) / 못 받음(missing) */
  workerConfirmStatus: 'received' | 'missing' | null; workerConfirmedAt: string | null;
};
export type GigPayoutStaff = {
  staffId: string; name: string; workerLinked: boolean;
  status: 'active' | 'leave' | 'ended';
  payBasis: 'hourly' | 'daily' | 'monthly' | null; payRate: number | null;
  bankName: string | null; accountNumber: string | null; accountLast4: string | null;
  accountHolderName: string | null; bankSharedAt: string | null;
  unpaidSince: string; unpaidUntil: string; unpaidMinutes: number; unpaidDays: number; unpaidAmount: number;
  /** 이번 미지급 계산에서 차감한 휴게 합계 */
  unpaidBreakMinutes: number;
  /** 이번 주(월~일) 인정 근무 분 — 주휴수당 안내용 */
  weekMinutes: number;
  /** 오늘 출근했고 아직 퇴근 전 — 지금 지급하면 오늘 근무가 다음 지급으로 넘어간다 */
  openToday: boolean;
  payouts: GigPayout[];
};

function todayKST() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }

export function amountFor(basis: string | null, rate: number | null, minutes: number, days: number) {
  if (!basis || !rate) return 0;
  if (basis === 'hourly') return Math.round((minutes / 60) * rate);
  if (basis === 'daily') return days * rate;
  return rate; // monthly: 기간과 무관하게 정액 (긱워커에서는 거의 쓰지 않는다)
}

// 휴게: 행에 적힌 값이 있으면 그대로, 없으면(옛 기록) 4시간 이상일 때만 근무자 기본 휴게를 적용한다.
// 새 기록은 DB 트리거(fill_staff_attendance_break)가 같은 규칙으로 행에 적는다.
export function effectiveBreakMinutes(workedMinutes: number, rowBreak: number | null | undefined, staffDefault: number | null | undefined) {
  const explicit = Number(rowBreak ?? 0);
  if (explicit > 0) return Math.min(explicit, workedMinutes);
  if (workedMinutes < 240) return 0;
  return Math.min(Number(staffDefault ?? 0), workedMinutes);
}

export type WorkSummary = { minutes: number; days: number; breakMinutes: number; firstDate: string | null; lastDate: string | null; lastCheckOut: string | null };
const EMPTY_WORK: WorkSummary = { minutes: 0, days: 0, breakMinutes: 0, firstDate: null, lastDate: null, lastCheckOut: null };

// 완료된 근무 기록을 묶어 시간·일수를 센다. 서버 액션도 같은 함수로 다시 계산한다 (클라이언트 값은 믿지 않는다).
// afterCheckOut: 마지막 지급에 포함된 마지막 퇴근 시각 — 그 이후 퇴근한 기록만 센다(같은 날 두 번째 근무가 빠지지 않게).
export async function summarizeWork(
  sb: NonNullable<ReturnType<typeof adminClient>>, facilityId: string, staffId: string, since: string, until: string,
  options: { afterCheckOut?: string | null; defaultBreakMinutes?: number | null } = {},
): Promise<WorkSummary> {
  const { data } = await sb.from('staff_attendances').select('work_date,check_in_at,check_out_at,break_minutes,status')
    .eq('facility_id', facilityId).eq('staff_id', staffId).eq('status', 'completed').gte('work_date', since).lte('work_date', until);
  const after = options.afterCheckOut ? Date.parse(options.afterCheckOut) : null;
  const out: WorkSummary = { ...EMPTY_WORK }; const days = new Set<string>();
  for (const row of (data ?? []) as Array<{ work_date: string; check_in_at: string | null; check_out_at: string | null; break_minutes: number | null }>) {
    if (!row.check_in_at || !row.check_out_at) continue;
    const checkedOut = Date.parse(row.check_out_at);
    if (after != null && checkedOut <= after) continue;
    const raw = Math.max(0, Math.round((checkedOut - Date.parse(row.check_in_at)) / 60000));
    const brk = effectiveBreakMinutes(raw, row.break_minutes, options.defaultBreakMinutes);
    out.minutes += Math.max(0, raw - brk); out.breakMinutes += brk; days.add(row.work_date);
    if (!out.firstDate || row.work_date < out.firstDate) out.firstDate = row.work_date;
    if (!out.lastDate || row.work_date > out.lastDate) out.lastDate = row.work_date;
    if (!out.lastCheckOut || checkedOut > Date.parse(out.lastCheckOut)) out.lastCheckOut = row.check_out_at;
  }
  out.days = days.size;
  return out;
}

export async function getGigPayoutBoard(accessToken?: string): Promise<GigPayoutStaff[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const today = todayKST();
  const [{ data: staff, error: staffError }, { data: payouts, error: payoutError }] = await Promise.all([
    // 병원·약국에서는 직원과 긱 근무자가 섞여 있다 — 지급 보드는 긱 근무자만 다룬다
    sb.from('facility_staff').select('id,name,worker_id,pay_basis,pay_rate,contract_start,status,default_break_minutes')
      .eq('facility_id', facilityId).eq('worker_kind', 'gig').order('name'),
    sb.from('gig_payouts').select('*').eq('facility_id', facilityId).neq('status', 'cancelled').order('created_at', { ascending: false }),
  ]);
  if (staffError || payoutError) throw new Error('긱워커 지급 정보를 불러오지 못했어요.');
  // 전체 계좌번호는 워커가 근무 완료 후 명시적으로 전달한 경우에만,
  // 현재 관리자 JWT로 권한 검증하는 RPC를 통해 가져온다.
  const scoped = accessToken ? userClient(accessToken) : null;
  if (!scoped) throw new Error('관리자 로그인을 다시 확인해 주세요.');
  const { data: sharedBanks, error: bankError } = await scoped.rpc('get_gig_shared_bank_accounts', { p_facility_id: facilityId });
  if (bankError) throw new Error(bankError.message.replace(/^.*?: /, '') || '근무자 지급 계좌를 불러오지 못했어요.');
  const bankByStaff = new Map(((sharedBanks ?? []) as Array<{ staff_id: string; bank_name: string; account_number: string; account_last4: string; account_holder_name: string; shared_at: string }>).map((bank) => [bank.staff_id, bank]));
  const byStaff = new Map<string, GigPayout[]>();
  for (const row of (payouts ?? []) as Array<Record<string, unknown>>) {
    const item: GigPayout = {
      id: row.id as string, staffId: row.staff_id as string, periodStart: row.period_start as string, periodEnd: row.period_end as string,
      workedMinutes: Number(row.worked_minutes), workedDays: Number(row.worked_days), payBasis: row.pay_basis as string, payRate: Number(row.pay_rate),
      amount: Number(row.amount), withholdingRate: Number(row.withholding_rate ?? 0), withholdingAmount: Number(row.withholding_amount ?? 0), netAmount: Number(row.net_amount ?? row.amount),
      status: row.status as GigPayout['status'], payAt: (row.pay_at as string | null) ?? null, paidAt: (row.paid_at as string | null) ?? null,
      note: (row.note as string | null) ?? null, createdAt: row.created_at as string,
      coveredUntil: (row.covered_until as string | null) ?? null,
      workerConfirmStatus: (row.worker_confirm_status as 'received' | 'missing' | null) ?? null, workerConfirmedAt: (row.worker_confirmed_at as string | null) ?? null,
    };
    (byStaff.get(item.staffId) ?? byStaff.set(item.staffId, []).get(item.staffId)!).push(item);
  }
  const rows: GigPayoutStaff[] = [];
  // 오늘 출근했고 아직 퇴근 전인 사람 — 지급 버튼 위에 '퇴근 뒤 지급'을 권한다
  const staffIds = ((staff ?? []) as Array<{ id: string }>).map((item) => item.id);
  const { data: openRows } = staffIds.length
    ? await sb.from('staff_attendances').select('staff_id').in('staff_id', staffIds).eq('work_date', today).not('check_in_at', 'is', null).is('check_out_at', null)
    : { data: [] as Array<{ staff_id: string }> };
  const openTodayIds = new Set(((openRows ?? []) as Array<{ staff_id: string }>).map((item) => item.staff_id));
  // 이번 주 인정 근무(주휴수당 안내용) — 정산과 같은 휴게 규칙
  const week = currentWeekRangeKST();
  const defaultBreakByStaff = new Map(((staff ?? []) as Array<{ id: string; default_break_minutes: number | null }>).map((item) => [item.id, Number(item.default_break_minutes ?? 0)]));
  const { data: weekRows } = staffIds.length
    ? await sb.from('staff_attendances').select('staff_id,check_in_at,check_out_at,break_minutes').in('staff_id', staffIds).eq('status', 'completed').gte('work_date', week.start).lte('work_date', week.end)
    : { data: [] as Array<{ staff_id: string; check_in_at: string | null; check_out_at: string | null; break_minutes: number | null }> };
  const weekMinutesByStaff = new Map<string, number>();
  for (const row of (weekRows ?? []) as Array<{ staff_id: string; check_in_at: string | null; check_out_at: string | null; break_minutes: number | null }>) {
    if (!row.check_in_at || !row.check_out_at) continue;
    const raw = Math.max(0, Math.round((Date.parse(row.check_out_at) - Date.parse(row.check_in_at)) / 60000));
    const brk = effectiveBreakMinutes(raw, row.break_minutes, defaultBreakByStaff.get(row.staff_id));
    weekMinutesByStaff.set(row.staff_id, (weekMinutesByStaff.get(row.staff_id) ?? 0) + Math.max(0, raw - brk));
  }
  for (const row of (staff ?? []) as Array<Record<string, unknown>>) {
    const staffId = row.id as string;
    const list = byStaff.get(staffId) ?? [];
    const last = list[0] ?? null;
    // 마지막 지급에 포함된 마지막 퇴근 시각 이후부터 센다. 옛 지급(covered_until 없음)은 종전대로 그 날짜 끝까지 포함된 것으로 본다
    const since = last ? last.periodEnd : ((row.contract_start as string | null) ?? '2020-01-01');
    const afterCheckOut = last ? (last.coveredUntil ?? `${last.periodEnd}T23:59:59+09:00`) : null;
    const work = since <= today
      ? await summarizeWork(sb, facilityId, staffId, since, today, { afterCheckOut, defaultBreakMinutes: Number(row.default_break_minutes ?? 0) })
      : EMPTY_WORK;
    const sharedBank = bankByStaff.get(staffId);
    const basis = (row.pay_basis as GigPayoutStaff['payBasis']) ?? null;
    const rate = row.pay_rate == null ? null : Number(row.pay_rate);
    rows.push({
      staffId, name: row.name as string, workerLinked: Boolean(row.worker_id),
      status: row.status as GigPayoutStaff['status'],
      payBasis: basis, payRate: rate,
      bankName: sharedBank?.bank_name ?? null,
      accountNumber: sharedBank?.account_number ?? null,
      accountLast4: sharedBank?.account_last4 ?? null,
      accountHolderName: sharedBank?.account_holder_name ?? null,
      bankSharedAt: sharedBank?.shared_at ?? null,
      unpaidSince: work.firstDate ?? since, unpaidUntil: work.lastDate ?? today, unpaidMinutes: work.minutes, unpaidDays: work.days,
      unpaidBreakMinutes: work.breakMinutes, weekMinutes: weekMinutesByStaff.get(staffId) ?? 0, openToday: openTodayIds.has(staffId),
      unpaidAmount: amountFor(basis, rate, work.minutes, work.days),
      payouts: list,
    });
  }
  return rows;
}
