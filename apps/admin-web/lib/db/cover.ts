import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';

// 근무 대타 요청 — DB: supabase/migrations/20261002100000_shift_cover_requests.sql
// 사업장 화면은 서버(service role)에서 읽고, 승인·거절은 사용자 토큰으로 RPC를 호출한다(권한 검사는 DB).

export type CoverRequestRow = {
  id: string;
  status: 'open' | 'claimed';
  shiftId: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  department: string | null;
  requiredRole: string | null;
  requesterName: string;
  claimerName: string | null;
  claimerRole: string | null;
  reason: string | null;
  createdAt: string;
};

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

/** 진행 중(아직 시작 전)인 대타 요청. 승인할 것(claimed)을 먼저, 그다음 근무 시각 순. */
export async function getActiveCoverRequests(): Promise<CoverRequestRow[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const { data, error } = await sb.from('shift_cover_requests')
    .select(`id,status,reason,created_at,
      shift:shifts(id,shift_date,start_time,end_time,is_overnight,department,required_role),
      requester:workers!shift_cover_requests_requester_worker_id_fkey(name),
      claimer:workers!shift_cover_requests_claimer_worker_id_fkey(name,role)`)
    .eq('facility_id', facilityId)
    .in('status', ['open', 'claimed']);
  if (error) throw new Error(`대타 요청을 불러오지 못했어요: ${error.message}`);
  const now = Date.now();
  return ((data ?? []) as any[])
    .map((row) => {
      const shift = one<any>(row.shift);
      const requester = one<any>(row.requester);
      const claimer = one<any>(row.claimer);
      return shift ? {
        id: row.id, status: row.status, shiftId: shift.id, shiftDate: shift.shift_date,
        startTime: shift.start_time, endTime: shift.end_time, isOvernight: Boolean(shift.is_overnight),
        department: shift.department ?? null, requiredRole: shift.required_role ?? null,
        requesterName: requester?.name ?? '근무자', claimerName: claimer?.name ?? null, claimerRole: claimer?.role ?? null,
        reason: row.reason ?? null, createdAt: row.created_at,
      } as CoverRequestRow : null;
    })
    .filter((row): row is CoverRequestRow => !!row && Date.parse(`${row.shiftDate}T${row.startTime.slice(0, 8)}+09:00`) > now)
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'claimed' ? -1 : 1)
      || a.shiftDate.localeCompare(b.shiftDate) || a.startTime.localeCompare(b.startTime));
}
