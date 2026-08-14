import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST } from '../date';

export type ShiftTemplateRow = {
  id: string;
  name: string;
  requiredRole: 'rn' | 'na' | 'pharmacist' | 'pharmacy_staff' | 'any';
  weekdays: number[];
  startTime: string;
  endTime: string;
  hourlyWage: number;
  description: string;
  department: string | null;
  requiredHeadcount: number;
};

export type OperationsSummary = {
  monthEstimatedCost: number;
  openShiftCount: number;
  urgentUnfilledCount: number;
  expiringCredentialCount: number;
  pendingWageCount: number;
};

export type OperationsAlert = {
  shiftId: string;
  kind: 'unfilled' | 'no_show';
  shiftDate: string;
  startTime: string;
  department: string | null;
};

export type CoverageDay = {
  date: string;
  planned: number;
  filled: number;
  recruiting: number;
  scheduleGap: number;
};

export type WorkforceRecommendation = {
  key: string;
  requirementId: string;
  requirementName: string;
  date: string;
  startTime: string;
  endTime: string;
  role: ShiftTemplateRow['requiredRole'];
  department: string | null;
  shortage: number;
  scheduled: number;
  required: number;
  leaveCount: number;
  absentCount: number;
  candidateCount: number;
  candidateNames: string[];
  reason: string;
};

export type StaffingRequirementRow = {
  id: string;
  name: string;
  department: string | null;
  requiredRole: ShiftTemplateRow['requiredRole'];
  weekdays: number[];
  startTime: string;
  endTime: string;
  requiredHeadcount: number;
  replacementHourlyWage: number;
  replacementDescription: string;
};

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function lastDayOfMonth(date: string) {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export async function getShiftTemplates(): Promise<ShiftTemplateRow[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const { data } = await sb.from('shift_templates')
    .select('id,name,required_role,weekdays,start_time,end_time,hourly_wage,description,department,required_headcount')
    .eq('facility_id', facilityId).eq('is_active', true).order('created_at', { ascending: false });
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id, name: row.name, requiredRole: row.required_role, weekdays: row.weekdays ?? [],
    startTime: row.start_time, endTime: row.end_time, hourlyWage: row.hourly_wage,
    description: row.description, department: row.department ?? null, requiredHeadcount: row.required_headcount ?? 1,
  }));
}

export async function getStaffingRequirements(): Promise<StaffingRequirementRow[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const { data } = await sb.from('staffing_requirements')
    .select('id,name,department,required_role,weekdays,start_time,end_time,required_headcount,replacement_hourly_wage,replacement_description')
    .eq('facility_id', facilityId).eq('is_active', true).order('department').order('start_time');
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id, name: row.name, department: row.department ?? null, requiredRole: row.required_role,
    weekdays: row.weekdays ?? [], startTime: row.start_time, endTime: row.end_time,
    requiredHeadcount: Number(row.required_headcount ?? 1), replacementHourlyWage: Number(row.replacement_hourly_wage),
    replacementDescription: row.replacement_description,
  }));
}

export async function getOperationsAlerts(): Promise<OperationsAlert[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const now = new Date();
  const today = todayKST(now);
  const alertStart = addDays(today, -1);
  const urgentEnd = addDays(today, 2);
  const { data: shifts } = await sb.from('shifts').select('id,shift_date,start_time,end_time,is_overnight,department,status,is_replacement')
    .eq('facility_id', facilityId).gte('shift_date', alertStart).lte('shift_date', urgentEnd)
    .in('status', ['open','matched']).order('shift_date').order('start_time');
  if (!shifts?.length) return [];
  const ids = shifts.map((row: any) => row.id);
  const [{ data: apps }, { data: attendances }] = await Promise.all([
    sb.from('shift_applications').select('shift_id,status').in('shift_id', ids).in('status', ['applied','accepted']),
    sb.from('shift_attendances').select('shift_id,check_in_at').in('shift_id', ids).not('check_in_at', 'is', null),
  ]);
  const appByShift = new Set((apps ?? []).map((row: any) => row.shift_id));
  const checkedIn = new Set((attendances ?? []).map((row: any) => row.shift_id));
  const nowMs = now.getTime();
  const alerts: OperationsAlert[] = [];
  for (const shift of shifts as any[]) {
    if (shift.shift_date < today && !shift.is_overnight) continue;
    const startMs = Date.parse(`${shift.shift_date}T${shift.start_time}+09:00`);
    if (shift.status === 'open' && startMs >= nowMs && !appByShift.has(shift.id)) {
      alerts.push({ shiftId: shift.id, kind: 'unfilled', shiftDate: shift.shift_date, startTime: shift.start_time, department: shift.department ?? null });
      continue;
    }
    if (shift.status === 'matched' && !checkedIn.has(shift.id) && nowMs >= startMs + 30 * 60_000) {
      alerts.push({ shiftId: shift.id, kind: 'no_show', shiftDate: shift.shift_date, startTime: shift.start_time, department: shift.department ?? null });
    }
  }
  return alerts;
}

/**
 * 반복 근무표와 실제 시프트를 함께 비교한다.
 * scheduleGap은 아직 공고조차 생성되지 않은 인원, recruiting은 생성됐지만
 * 워커가 확정되지 않은 인원이다. 두 상태를 섞지 않아 관리자가 다음 행동을
 * 한 번에 판단할 수 있게 한다.
 */
export async function getWorkforceCoverage(days = 7): Promise<CoverageDay[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const today = todayKST();
  const end = addDays(today, Math.max(1, days) - 1);
  const [{ data: templates }, { data: shifts }] = await Promise.all([
    sb.from('shift_templates').select('id,weekdays,required_headcount').eq('facility_id', facilityId).eq('is_active', true),
    sb.from('shifts').select('id,template_id,shift_date,status').eq('facility_id', facilityId)
      .gte('shift_date', today).lte('shift_date', end).neq('status', 'cancelled'),
  ]);
  const rows = (shifts ?? []) as any[];
  return Array.from({ length: Math.max(1, days) }, (_, index) => {
    const date = addDays(today, index);
    // 달력 날짜 자체의 요일 — 서버 타임존과 무관하게 UTC로 고정 (생성 액션의 getUTCDay 규약과 동일)
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    const dueTemplates = ((templates ?? []) as any[]).filter((template) => (template.weekdays ?? []).includes(weekday));
    const expected = dueTemplates.reduce((sum, template) => sum + Number(template.required_headcount ?? 1), 0);
    const dayShifts = rows.filter((shift) => shift.shift_date === date);
    const generatedTemplateShifts = dayShifts.filter((shift) => shift.template_id && dueTemplates.some((template) => template.id === shift.template_id)).length;
    const recruiting = dayShifts.filter((shift) => shift.status === 'open').length;
    const filled = dayShifts.filter((shift) => ['matched', 'in_progress', 'completed'].includes(shift.status)).length;
    return {
      date,
      planned: Math.max(expected, dayShifts.length),
      filled,
      recruiting,
      scheduleGap: Math.max(0, expected - generatedTemplateShifts),
    };
  });
}

/**
 * 설명 가능한 규칙 기반 충원 추천이다. 시설이 고정한 최소 필요 인원에서
 * 근무 예정 고정 직원과 확정 단기 인력을 더하고 휴가·결근을 제외한다. 후보는 같은
 * 직군의 활성 인력풀 중 같은 날 확정 근무가 없는 워커를 최근 근무순으로 제시한다.
 */
export async function getWorkforceRecommendations(days = 7): Promise<WorkforceRecommendation[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const today = todayKST();
  const end = addDays(today, Math.max(1, days) - 1);
  const [{ data: requirements }, { data: shifts }, { data: staff }, { data: leaves }, { data: attendances }, { data: pool }] = await Promise.all([
    sb.from('staffing_requirements').select('id,name,required_role,weekdays,start_time,end_time,department,required_headcount').eq('facility_id', facilityId).eq('is_active', true),
    sb.from('shifts').select('id,shift_date,start_time,end_time,required_role,department,status').eq('facility_id', facilityId).gte('shift_date', today).lte('shift_date', end).neq('status', 'cancelled'),
    sb.from('facility_staff').select('id,role,department,work_weekdays,default_start_time,default_end_time,contract_start,contract_end,status').eq('facility_id', facilityId).neq('status', 'ended'),
    sb.from('staff_leave_requests').select('staff_id,start_date,end_date,leave_type,status').eq('facility_id', facilityId).eq('status', 'approved').in('leave_type', ['annual','sick','other']).lte('start_date', end).gte('end_date', today),
    sb.from('staff_attendances').select('staff_id,work_date,status').eq('facility_id', facilityId).gte('work_date', today).lte('work_date', end).eq('status', 'absent'),
    sb.from('facility_worker_pool').select('worker_id,completed_shift_count,last_worked_at').eq('facility_id', facilityId).eq('status', 'active'),
  ]);
  const workerIds = (pool ?? []).map((row: any) => row.worker_id);
  const [{ data: workers }, { data: busyShifts }] = await Promise.all([
    workerIds.length ? sb.from('workers').select('id,name,role').in('id', workerIds).eq('verification_status', 'approved').is('deleted_at', null) : Promise.resolve({ data: [] }),
    sb.from('shifts').select('id,shift_date,start_time,end_time').gte('shift_date', addDays(today, -1)).lte('shift_date', end).in('status', ['matched','in_progress']),
  ]);
  const busyShiftIds = (busyShifts ?? []).map((row: any) => row.id);
  const { data: busyApplications } = busyShiftIds.length
    ? await sb.from('shift_applications').select('worker_id,shift_id').in('shift_id', busyShiftIds).eq('status', 'accepted')
    : { data: [] };
  const busyShiftById = new Map((busyShifts ?? []).map((row: any) => [row.id, row]));
  const busyByWorker = new Map<string, any[]>();
  for (const application of (busyApplications ?? []) as any[]) {
    const shift = busyShiftById.get(application.shift_id);
    if (!shift) continue;
    busyByWorker.set(application.worker_id, [...(busyByWorker.get(application.worker_id) ?? []), shift]);
  }
  const workerById = new Map((workers ?? []).map((row: any) => [row.id, row]));
  const rankedPool = [...(pool ?? [])].sort((a: any, b: any) =>
    Number(b.completed_shift_count ?? 0) - Number(a.completed_shift_count ?? 0)
      || String(b.last_worked_at ?? '').localeCompare(String(a.last_worked_at ?? '')));
  const recommendations: WorkforceRecommendation[] = [];
  for (let offset = 0; offset < Math.max(1, days); offset += 1) {
    const date = addDays(today, offset);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    for (const requirement of (requirements ?? []) as any[]) {
      if (!(requirement.weekdays ?? []).includes(weekday)) continue;
      const overlaps = (startA: string, endA: string, startB: string, endB: string) => {
        const toMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
        const aStart = toMinute(startA); let aEnd = toMinute(endA);
        const bStart = toMinute(startB); let bEnd = toMinute(endB);
        if (aEnd <= aStart) aEnd += 24 * 60;
        if (bEnd <= bStart) bEnd += 24 * 60;
        return aStart < bEnd && bStart < aEnd;
      };
      const matchingStaff = ((staff ?? []) as any[]).filter((person) =>
        person.status === 'active'
        && (!person.contract_start || person.contract_start <= date)
        && (!person.contract_end || person.contract_end >= date)
        && (person.work_weekdays ?? [1,2,3,4,5]).includes(weekday)
        && (requirement.required_role === 'any' || person.role === requirement.required_role)
        && (!requirement.department || person.department === requirement.department)
        && overlaps(requirement.start_time, requirement.end_time, person.default_start_time, person.default_end_time));
      const staffOnLeave = new Set(matchingStaff.filter((person) => (leaves ?? []).some((leave: any) => leave.staff_id === person.id && leave.start_date <= date && leave.end_date >= date)).map((person) => person.id));
      const leaveCount = staffOnLeave.size;
      const absentCount = matchingStaff.filter((person) => !staffOnLeave.has(person.id) && (attendances ?? []).some((attendance: any) => attendance.staff_id === person.id && attendance.work_date === date)).length;
      const availableFixedStaff = Math.max(0, matchingStaff.length - leaveCount - absentCount);
      const committedShiftCount = ((shifts ?? []) as any[]).filter((shift) =>
        shift.shift_date === date
        && ['open','matched','in_progress','completed'].includes(shift.status)
        && (shift.status !== 'open' || Date.parse(`${shift.shift_date}T${shift.start_time}+09:00`) > Date.now())
        && (requirement.required_role === 'any' || shift.required_role === requirement.required_role)
        && (!requirement.department || shift.department === requirement.department)
        && overlaps(requirement.start_time, requirement.end_time, shift.start_time, shift.end_time)).length;
      const scheduled = availableFixedStaff + committedShiftCount;
      const required = Number(requirement.required_headcount ?? 1);
      const shortage = Math.max(0, required - scheduled);
      if (!shortage) continue;
      const candidates = rankedPool.flatMap((entry: any) => {
        const worker: any = workerById.get(entry.worker_id);
        if (!worker) return [];
        const proposedStart = Date.parse(`${date}T${requirement.start_time}+09:00`);
        let proposedEnd = Date.parse(`${date}T${requirement.end_time}+09:00`);
        if (proposedEnd <= proposedStart) proposedEnd += 86_400_000;
        const hasConflict = (busyByWorker.get(entry.worker_id) ?? []).some((shift: any) => {
          const busyStart = Date.parse(`${shift.shift_date}T${shift.start_time}+09:00`);
          let busyEnd = Date.parse(`${shift.shift_date}T${shift.end_time}+09:00`);
          if (busyEnd <= busyStart) busyEnd += 86_400_000;
          return proposedStart < busyEnd && busyStart < proposedEnd;
        });
        if (hasConflict) return [];
        if (requirement.required_role !== 'any' && worker.role !== requirement.required_role) return [];
        return [worker];
      });
      const causes = [
        leaveCount ? `승인 휴가 ${leaveCount}명` : '',
        absentCount ? `결근 ${absentCount}명` : '',
        shortage ? `기준 대비 ${shortage}명 부족` : '',
      ].filter(Boolean);
      recommendations.push({
        key: `${requirement.id}:${date}`, requirementId: requirement.id, requirementName: requirement.name,
        date, startTime: requirement.start_time, endTime: requirement.end_time, role: requirement.required_role,
        department: requirement.department ?? null, shortage, scheduled, required, leaveCount, absentCount,
        candidateCount: candidates.length, candidateNames: candidates.slice(0, 3).map((worker: any) => worker.name),
        reason: causes.join(' · ') || `필요 ${required}명 중 ${scheduled}명 편성`,
      });
    }
  }
  return recommendations.sort((a, b) => a.date.localeCompare(b.date) || b.shortage - a.shortage || a.startTime.localeCompare(b.startTime));
}

export async function getOperationsSummary(): Promise<OperationsSummary> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return { monthEstimatedCost: 0, openShiftCount: 0, urgentUnfilledCount: 0, expiringCredentialCount: 0, pendingWageCount: 0 };
  const today = todayKST();
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = lastDayOfMonth(today);
  const urgentEnd = addDays(today, 2);

  const [{ data: shifts }, { data: urgent }, { data: pool }, { count: pendingWageCount }, { count: pendingStaffWageCount }] = await Promise.all([
    sb.from('shifts').select('estimated_total_pay,status').eq('facility_id', facilityId).gte('shift_date', monthStart).lte('shift_date', monthEnd).neq('status', 'cancelled'),
    sb.from('shifts').select('id').eq('facility_id', facilityId).eq('status', 'open').gte('shift_date', today).lte('shift_date', urgentEnd),
    sb.from('facility_worker_pool').select('worker_id').eq('facility_id', facilityId).eq('status', 'active'),
    sb.from('wage_payment_instructions').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).in('status', ['draft','approved','exported','disputed']),
    sb.from('staff_wage_payments').select('id',{count:'exact',head:true}).eq('facility_id',facilityId).in('status',['draft','approved','exported']),
  ]);

  const urgentIds = (urgent ?? []).map((row: any) => row.id);
  let urgentUnfilledCount = urgentIds.length;
  if (urgentIds.length) {
    const { data: apps } = await sb.from('shift_applications').select('shift_id').in('shift_id', urgentIds).eq('status', 'applied');
    const withApplicant = new Set((apps ?? []).map((row: any) => row.shift_id));
    urgentUnfilledCount = urgentIds.filter((id: string) => !withApplicant.has(id)).length;
  }

  const workerIds = (pool ?? []).map((row: any) => row.worker_id);
  let expiringCredentialCount = 0;
  if (workerIds.length) {
    const limit = addDays(today, 30);
    const { count } = await sb.from('worker_credentials').select('id', { count: 'exact', head: true })
      .in('worker_id', workerIds).lte('expires_at', limit).in('verification_status', ['approved','expired']);
    expiringCredentialCount = count ?? 0;
  }

  return {
    monthEstimatedCost: (shifts ?? []).reduce((sum: number, row: any) => sum + (row.estimated_total_pay ?? 0), 0),
    openShiftCount: (shifts ?? []).filter((row: any) => row.status === 'open').length,
    urgentUnfilledCount,
    expiringCredentialCount,
    pendingWageCount: (pendingWageCount ?? 0)+(pendingStaffWageCount??0),
  };
}
