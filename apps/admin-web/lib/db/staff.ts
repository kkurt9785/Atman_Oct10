import { adminClient, ORG_ID } from '../supabase';
import { STAFF, SUMMARY } from '../mock';

export type StaffRow = {
  id: string;
  name: string;
  job: string;
  todayStatus: '근무중' | '퇴근' | '예정' | '결근';
  monthMinutes: number;
  hourlyWage: number;
};

export type SummaryInfo = {
  totalMinutes: number;
  estimatedPay: number;
  workingNow: number;
};

export async function getStaff(): Promise<StaffRow[]> {
  const sb = adminClient();
  if (!sb || !ORG_ID) return STAFF;

  const today = new Date().toISOString().slice(0, 10);

  // Workers with any shift at this facility + today's attendance
  const { data } = await sb
    .from('shifts')
    .select(`
      id,
      worker_id,
      workers ( id, name, role ),
      shift_attendances ( check_in_at, check_out_at )
    `)
    .eq('facility_id', ORG_ID)
    .gte('start_time', `${today}T00:00:00`)
    .lte('start_time', `${today}T23:59:59`);

  if (!data || data.length === 0) return STAFF;

  // Also get monthly hours from payroll_ledger
  const workerIds = [...new Set((data as any[]).map((r) => r.worker_id))];
  const monthStart = `${today.slice(0, 7)}-01`;
  const { data: ledger } = await sb
    .from('payroll_ledger')
    .select('worker_id, worked_minutes')
    .eq('org_id', ORG_ID)
    .in('worker_id', workerIds)
    .gte('work_date', monthStart);

  const monthMap: Record<string, number> = {};
  for (const row of (ledger ?? []) as any[]) {
    monthMap[row.worker_id] = (monthMap[row.worker_id] ?? 0) + row.worked_minutes;
  }

  return (data as any[]).map((shift) => {
    const worker = shift.workers;
    const att = shift.shift_attendances?.[0];
    let todayStatus: StaffRow['todayStatus'] = '예정';
    if (att?.check_in_at && att?.check_out_at) todayStatus = '퇴근';
    else if (att?.check_in_at) todayStatus = '근무중';

    return {
      id: worker.id,
      name: worker.name,
      job: worker.role,
      todayStatus,
      monthMinutes: monthMap[worker.id] ?? 0,
      hourlyWage: 10320, // 2026 최저시급 기본값 — 실제 계약임금은 employment_contracts에서
    };
  });
}

export async function getSummary(staff: StaffRow[]): Promise<SummaryInfo> {
  if (staff === STAFF) return SUMMARY;
  return {
    totalMinutes: staff.reduce((s, x) => s + x.monthMinutes, 0),
    estimatedPay: staff.reduce(
      (s, x) => s + Math.round((x.monthMinutes / 60) * x.hourlyWage),
      0
    ),
    workingNow: staff.filter((x) => x.todayStatus === '근무중').length,
  };
}
