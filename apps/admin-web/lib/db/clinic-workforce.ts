import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST } from '../date';

export type ClinicStaff = {
  id: string;
  name: string;
  role: string;
  department: string | null;
  source: 'direct' | 'atman' | 'imported';
  engagementType: 'regular' | 'fixed_term' | 'temporary' | 'daily';
  contractStart: string | null;
  contractEnd: string | null;
  defaultStart: string;
  defaultEnd: string;
  status: 'active' | 'leave' | 'ended';
  attendanceStatus: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkoutRequestedAt: string | null;
  leaveMinutes: number;
};

export async function getClinicStaff(): Promise<ClinicStaff[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const today = todayKST();
  const year = Number(today.slice(0, 4));
  const [{ data: staff }, { data: attendance }, { data: balances }, { data: leaves }] = await Promise.all([
    sb.from('facility_staff').select('*').eq('facility_id', facilityId).neq('status', 'ended').order('name'),
    sb.from('staff_attendances').select('*').eq('facility_id', facilityId).eq('work_date', today),
    sb.from('staff_leave_balances').select('staff_id,granted_minutes,used_minutes')
      .eq('facility_id', facilityId).eq('leave_year', year),
    sb.from('staff_leave_requests').select('staff_id').eq('facility_id', facilityId)
      .eq('status', 'approved').lte('start_date', today).gte('end_date', today),
  ]);
  const attendanceMap = new Map((attendance ?? []).map((row: any) => [row.staff_id, row]));
  const balanceMap = new Map((balances ?? []).map((row: any) => [row.staff_id, Math.max(0, row.granted_minutes - row.used_minutes)]));
  const leaveSet = new Set((leaves ?? []).map((row: any) => row.staff_id));
  return ((staff ?? []) as any[]).map((row) => {
    const att: any = attendanceMap.get(row.id);
    return {
      id: row.id, name: row.name, role: row.role, department: row.department,
      source: row.source, engagementType: row.engagement_type,
      contractStart: row.contract_start, contractEnd: row.contract_end,
      defaultStart: row.default_start_time, defaultEnd: row.default_end_time,
      status: row.status, attendanceStatus: att?.status ?? (row.status === 'leave' || leaveSet.has(row.id) ? 'leave' : 'scheduled'),
      checkInAt: att?.check_in_at ?? null, checkOutAt: att?.check_out_at ?? null,
      checkoutRequestedAt: att?.checkout_requested_at ?? null,
      leaveMinutes: Number(balanceMap.get(row.id) ?? 0),
    };
  });
}

export async function getFacilityAttendanceQr(): Promise<string | null> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return null;
  const { data: existing } = await sb.from('facility_attendance_qr')
    .select('token').eq('facility_id', facilityId).eq('is_active', true).maybeSingle();
  if (existing?.token) return existing.token;
  const { data } = await sb.from('facility_attendance_qr')
    .upsert({ facility_id: facilityId, is_active: true }, { onConflict: 'facility_id' })
    .select('token').single();
  return data?.token ?? null;
}

export async function getClinicLeaveRequests() {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const { data } = await sb.from('staff_leave_requests')
    .select('id,staff_id,leave_type,start_date,end_date,requested_minutes,status,reason,facility_staff(name)')
    .eq('facility_id', facilityId).order('start_date', { ascending: false }).limit(30);
  return data ?? [];
}
