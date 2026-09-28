import { adminClient, userClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';

// 긱워커 지급 보드. 근무자별로 '마지막 지급 이후 완료된 근무'를 묶어 금액을 계산한다.
// 하루가 끝나면 그날 것만, 일주일 뒤면 일주일치가 한 건으로 잡힌다. 실제 이체는 관리자가 하고 여기엔 기록만 남는다.

export type GigPayout = {
  id: string; staffId: string; periodStart: string; periodEnd: string; workedMinutes: number; workedDays: number;
  payBasis: string; payRate: number; amount: number; withholdingRate: number; withholdingAmount: number; netAmount: number;
  status: 'scheduled' | 'paid' | 'cancelled'; payAt: string | null; paidAt: string | null; note: string | null; createdAt: string;
};
export type GigPayoutStaff = {
  staffId: string; name: string; workerLinked: boolean;
  status: 'active' | 'leave' | 'ended';
  payBasis: 'hourly' | 'daily' | 'monthly' | null; payRate: number | null;
  bankName: string | null; accountNumber: string | null; accountLast4: string | null;
  accountHolderName: string | null; bankSharedAt: string | null;
  unpaidSince: string; unpaidUntil: string; unpaidMinutes: number; unpaidDays: number; unpaidAmount: number;
  payouts: GigPayout[];
};

function todayKST() { return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function nextDay(date: string) { return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10); }

export function amountFor(basis: string | null, rate: number | null, minutes: number, days: number) {
  if (!basis || !rate) return 0;
  if (basis === 'hourly') return Math.round((minutes / 60) * rate);
  if (basis === 'daily') return days * rate;
  return rate; // monthly: 기간과 무관하게 정액 (긱워커에서는 거의 쓰지 않는다)
}

// 완료된 근무 기록을 기간으로 묶어 시간·일수를 센다. 서버 액션도 같은 함수로 다시 계산한다 (클라이언트 값은 믿지 않는다).
export async function summarizeWork(sb: NonNullable<ReturnType<typeof adminClient>>, facilityId: string, staffId: string, since: string, until: string) {
  const { data } = await sb.from('staff_attendances').select('work_date,check_in_at,check_out_at,break_minutes,status')
    .eq('facility_id', facilityId).eq('staff_id', staffId).eq('status', 'completed').gte('work_date', since).lte('work_date', until);
  let minutes = 0; const days = new Set<string>();
  for (const row of (data ?? []) as Array<{ work_date: string; check_in_at: string | null; check_out_at: string | null; break_minutes: number | null }>) {
    if (!row.check_in_at || !row.check_out_at) continue;
    minutes += Math.max(0, Math.round((new Date(row.check_out_at).getTime() - new Date(row.check_in_at).getTime()) / 60000) - Number(row.break_minutes ?? 0));
    days.add(row.work_date);
  }
  return { minutes, days: days.size };
}

export async function getGigPayoutBoard(accessToken?: string): Promise<GigPayoutStaff[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const today = todayKST();
  const [{ data: staff, error: staffError }, { data: payouts, error: payoutError }] = await Promise.all([
    sb.from('facility_staff').select('id,name,worker_id,pay_basis,pay_rate,contract_start,status')
      .eq('facility_id', facilityId).order('name'),
    sb.from('gig_payouts').select('*').eq('facility_id', facilityId).neq('status', 'cancelled').order('period_end', { ascending: false }),
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
    };
    (byStaff.get(item.staffId) ?? byStaff.set(item.staffId, []).get(item.staffId)!).push(item);
  }
  const rows: GigPayoutStaff[] = [];
  for (const row of (staff ?? []) as Array<Record<string, unknown>>) {
    const staffId = row.id as string;
    const list = byStaff.get(staffId) ?? [];
    const lastEnd = list[0]?.periodEnd ?? null;
    const since = lastEnd ? nextDay(lastEnd) : ((row.contract_start as string | null) ?? '2020-01-01');
    const work = since <= today ? await summarizeWork(sb, facilityId, staffId, since, today) : { minutes: 0, days: 0 };
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
      unpaidSince: since, unpaidUntil: today, unpaidMinutes: work.minutes, unpaidDays: work.days,
      unpaidAmount: amountFor(basis, rate, work.minutes, work.days),
      payouts: list,
    });
  }
  return rows;
}
