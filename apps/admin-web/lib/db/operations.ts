import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST } from '../date';

export type ShiftTemplateRow = {
  id: string;
  name: string;
  requiredRole: 'rn' | 'na' | 'any';
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

export async function getOperationsSummary(): Promise<OperationsSummary> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return { monthEstimatedCost: 0, openShiftCount: 0, urgentUnfilledCount: 0, expiringCredentialCount: 0, pendingWageCount: 0 };
  const today = todayKST();
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = lastDayOfMonth(today);
  const urgentEnd = addDays(today, 2);

  const [{ data: shifts }, { data: urgent }, { data: pool }, { count: pendingWageCount }] = await Promise.all([
    sb.from('shifts').select('estimated_total_pay,status').eq('facility_id', facilityId).gte('shift_date', monthStart).lte('shift_date', monthEnd).neq('status', 'cancelled'),
    sb.from('shifts').select('id').eq('facility_id', facilityId).eq('status', 'open').gte('shift_date', today).lte('shift_date', urgentEnd),
    sb.from('facility_worker_pool').select('worker_id').eq('facility_id', facilityId).eq('status', 'active'),
    sb.from('wage_payment_instructions').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).in('status', ['draft','approved','exported','disputed']),
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
    pendingWageCount: pendingWageCount ?? 0,
  };
}
