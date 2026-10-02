import 'server-only';
import { adminClient, userClient } from '../supabase';
import { getAdminContext } from '../admin-auth';
import { todayKST } from '../date';
import { MIN_HOURLY_WAGE_2026 } from '../pay';
import { getWorkforceRecommendations } from './operations';

// 결원 채우기 — 결원이 어디서 왔든(미충원 공고·노쇼·직원 미출근·필요 인원 부족) 한 화면에서
// 같은 모양(날짜·시간·직군·시급)으로 다룬다. 근무가 아직 없으면 요청을 보낼 때 만든다.

export type VacancySource =
  | { mode: 'shift'; shiftId: string }
  | { mode: 'replace'; shiftId: string }
  | { mode: 'staff'; staffId: string; date: string }
  | { mode: 'rec'; key: string };

export type Vacancy = {
  source: VacancySource;
  cause: string;
  date: string;
  startTime: string;
  endTime: string;
  role: string;
  department: string | null;
  hourlyWage: number;
  description: string;
  shiftId: string | null;          // 이미 있는 근무(요청을 붙일 곳)
  shiftStatus: string | null;
  audience: string | null;
  matchedName: string | null;
};

export type VacancyCandidate = {
  kind: 'staff' | 'pool';
  staffId: string | null;
  workerId: string | null;
  name: string;
  role: string;
  completedShiftCount: number | null;
  lastWorkedAt: string | null;
  blockReason: string | null;
  requestStatus: string | null;
};

export function parseVacancySource(params: Record<string, string | undefined>): VacancySource | null {
  if (params.shift) return { mode: 'shift', shiftId: params.shift };
  if (params.replace) return { mode: 'replace', shiftId: params.replace };
  if (params.staff) return { mode: 'staff', staffId: params.staff, date: /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : todayKST() };
  if (params.rec) return { mode: 'rec', key: params.rec };
  return null;
}

async function lastWageForRole(facilityId: string, role: string): Promise<number | null> {
  const sb = adminClient();
  if (!sb) return null;
  const { data } = await sb.from('shifts').select('hourly_wage').eq('facility_id', facilityId).eq('required_role', role)
    .neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data?.hourly_wage ? Number(data.hourly_wage) : null;
}

export async function resolveVacancy(source: VacancySource): Promise<Vacancy | null> {
  const context = await getAdminContext();
  const sb = adminClient();
  if (!context || !sb) return null;
  const facilityId = context.facilityId;

  const fromShift = async (shiftId: string, cause: string): Promise<Vacancy | null> => {
    const { data: shift } = await sb.from('shifts')
      .select('id,shift_date,start_time,end_time,required_role,department,hourly_wage,description,status,audience,matched_worker_id,workers!shifts_matched_worker_id_fkey(name)')
      .eq('id', shiftId).eq('facility_id', facilityId).maybeSingle();
    if (!shift) return null;
    const matched = Array.isArray((shift as any).workers) ? (shift as any).workers[0] : (shift as any).workers;
    return {
      source: { mode: 'shift', shiftId: shift.id }, cause,
      date: shift.shift_date, startTime: String(shift.start_time).slice(0, 5), endTime: String(shift.end_time).slice(0, 5),
      role: shift.required_role, department: shift.department ?? null, hourlyWage: Number(shift.hourly_wage),
      description: shift.description ?? '', shiftId: shift.id, shiftStatus: shift.status, audience: shift.audience,
      matchedName: matched?.name ?? null,
    };
  };

  if (source.mode === 'shift') return fromShift(source.shiftId, '지원자가 없는 근무');

  if (source.mode === 'replace') {
    // 이미 만든 대체 근무가 있으면 그 근무에 이어서 요청한다
    const { data: existing } = await sb.from('shifts').select('id').eq('replacement_for_shift_id', source.shiftId)
      .eq('facility_id', facilityId).neq('status', 'cancelled').maybeSingle();
    if (existing) return fromShift(existing.id, '확정 근무자 미출근');
    const original = await fromShift(source.shiftId, '확정 근무자 미출근');
    if (!original) return null;
    return {
      ...original, source, shiftId: null, shiftStatus: null, audience: null,
      cause: `${original.matchedName ?? '확정 근무자'}님 미출근`, description: `[결원 대체] ${original.description}`, matchedName: null,
    };
  }

  if (source.mode === 'staff') {
    const { data: staff } = await sb.from('facility_staff')
      .select('id,name,role,department,default_start_time,default_end_time,pay_basis,pay_rate,workers(role)')
      .eq('id', source.staffId).eq('facility_id', facilityId).maybeSingle();
    if (!staff) return null;
    const worker = Array.isArray((staff as any).workers) ? (staff as any).workers[0] : (staff as any).workers;
    const role = worker?.role ?? staff.role;
    const wage = staff.pay_basis === 'hourly' && Number(staff.pay_rate) >= MIN_HOURLY_WAGE_2026
      ? Number(staff.pay_rate)
      : (await lastWageForRole(facilityId, role)) ?? MIN_HOURLY_WAGE_2026;
    return {
      source, cause: `${staff.name ?? '직원'}님 결원`,
      date: source.date, startTime: String(staff.default_start_time ?? '09:00').slice(0, 5), endTime: String(staff.default_end_time ?? '18:00').slice(0, 5),
      role, department: staff.department ?? null, hourlyWage: wage,
      description: `${staff.department ? `${staff.department} ` : ''}결원 대체 근무`,
      shiftId: null, shiftStatus: null, audience: null, matchedName: null,
    };
  }

  const recommendation = (await getWorkforceRecommendations(7)).find((item) => item.key === source.key);
  if (!recommendation) return null;
  const { data: requirement } = await sb.from('staffing_requirements')
    .select('replacement_hourly_wage,replacement_description').eq('id', recommendation.requirementId).eq('facility_id', facilityId).maybeSingle();
  return {
    source, cause: recommendation.reason,
    date: recommendation.date, startTime: recommendation.startTime.slice(0, 5), endTime: recommendation.endTime.slice(0, 5),
    role: recommendation.role, department: recommendation.department,
    hourlyWage: Number(requirement?.replacement_hourly_wage ?? MIN_HOURLY_WAGE_2026),
    description: requirement?.replacement_description ?? '결원 대체 근무',
    shiftId: null, shiftStatus: null, audience: null, matchedName: null,
  };
}

// 후보는 DB가 판단한다(직원·인력풀, 자격, 휴가, 같은 시간 근무). 화면은 고르기만 한다.
export async function getVacancyCandidates(vacancy: Vacancy): Promise<VacancyCandidate[]> {
  const context = await getAdminContext();
  const sb = context ? userClient(context.accessToken) : null;
  if (!context || !sb) return [];
  const { data, error } = await sb.rpc('list_vacancy_candidates', {
    p_facility_id: context.facilityId, p_date: vacancy.date, p_start: vacancy.startTime, p_end: vacancy.endTime,
    p_role: vacancy.role, p_shift_id: vacancy.shiftId,
  });
  if (error) throw new Error('요청할 사람 목록을 불러오지 못했어요.');
  return ((data ?? []) as any[]).map((row) => ({
    kind: row.kind, staffId: row.staff_id, workerId: row.worker_id, name: row.name ?? '이름 없음', role: row.role,
    completedShiftCount: row.completed_shift_count, lastWorkedAt: row.last_worked_at,
    blockReason: row.block_reason, requestStatus: row.request_status,
  }));
}
