import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST } from '../date';

export type StaffRow = {
  id: string;
  name: string;
  job: string;
  todayStatus: '근무중' | '퇴근' | '예정' | '결근';
  monthMinutes: number;
  hourlyWage: number;
  checkInAt?: string | null;
  checkOutAt?: string | null;
};

export type SummaryInfo = {
  totalMinutes: number;
  estimatedPay: number;
  workingNow: number;
};

function roleLabel(role: string | null): string {
  switch (role) {
    case 'rn':  return 'RN (정규직 간호사)';
    case 'na':  return 'NA (간호조무사)';
    case 'cna': return 'CNA';
    default:    return role ?? '스태프';
  }
}

export async function getStaff(): Promise<StaffRow[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];

  const today      = todayKST();
  const monthStart = `${today.slice(0, 7)}-01`;

  // 오늘 이 시설의 매칭된 시프트
  const { data: todayShifts, error } = await sb
    .from('shifts')
    .select('id, matched_worker_id')
    .eq('facility_id', facilityId)
    .eq('shift_date', today)
    .not('matched_worker_id', 'is', null);

  if (error || !todayShifts || todayShifts.length === 0) return [];

  const shiftIds  = (todayShifts as any[]).map((s) => s.id);
  const workerIds = [...new Set((todayShifts as any[]).map((s) => s.matched_worker_id as string))];

  // 병렬 조회
  const [
    { data: workers },
    { data: attendances },
    { data: wages },
  ] = await Promise.all([
    sb.from('workers').select('id, name, role').in('id', workerIds),
    sb.from('shift_attendances')
      .select('shift_id, worker_id, check_in_at, check_out_at')
      .in('shift_id', shiftIds),
    sb.from('wage_calculations')            // ← payroll_ledger 대신 wage_calculations
      .select('worker_id, worked_minutes')
      .eq('org_id', facilityId)
      .gte('calculated_at', `${monthStart}T00:00:00`)
      .in('worker_id', workerIds),
  ]);

  // 인덱싱
  const attByShift: Record<string, any>  = {};
  for (const a of (attendances ?? []) as any[]) attByShift[a.shift_id] = a;

  const monthMap: Record<string, number> = {};
  for (const w of (wages ?? []) as any[]) {
    monthMap[w.worker_id] = (monthMap[w.worker_id] ?? 0) + w.worked_minutes;
  }

  const workerMap: Record<string, any> = {};
  for (const w of (workers ?? []) as any[]) workerMap[w.id] = w;

  const rows = (todayShifts as any[])
    .map((shift) => {
      const worker = workerMap[shift.matched_worker_id];
      if (!worker) return null;
      const att = attByShift[shift.id];

      let todayStatus: StaffRow['todayStatus'] = '예정';
      if (att?.check_in_at && att?.check_out_at) todayStatus = '퇴근';
      else if (att?.check_in_at) todayStatus = '근무중';

      return {
        id:           worker.id,
        name:         worker.name,
        job:          roleLabel(worker.role),
        todayStatus,
        monthMinutes: monthMap[worker.id] ?? 0,
        hourlyWage:   10320,
        checkInAt:    att?.check_in_at  ?? null,
        checkOutAt:   att?.check_out_at ?? null,
      } satisfies StaffRow;
    })
    .filter(Boolean) as StaffRow[];

  return rows;
}

export async function getSummary(staff: StaffRow[]): Promise<SummaryInfo> {
  return {
    totalMinutes: staff.reduce((s, x) => s + x.monthMinutes, 0),
    estimatedPay: staff.reduce(
      (s, x) => s + Math.round((x.monthMinutes / 60) * x.hourlyWage),
      0
    ),
    workingNow: staff.filter((x) => x.todayStatus === '근무중').length,
  };
}
