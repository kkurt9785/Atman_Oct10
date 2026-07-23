import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST, yesterdayKST } from '../date';

export type ClinicStaff = {
  id: string;
  workerId: string | null;
  phone: string | null;
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
  workDate: string;
  leaveMinutes: number;
  inviteToken: string | null;
  inviteExpiresAt: string | null;
  payBasis: 'monthly'|'hourly'|'daily'|null;
  payRate: number|null;
  bankName:string|null;
  accountLast4:string|null;
};

export async function getClinicStaff(): Promise<ClinicStaff[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const today = todayKST();
  const year = Number(today.slice(0, 4));
  const [{ data: staff }, { data: attendance }, { data: balances }, { data: leaves }] = await Promise.all([
    sb.from('facility_staff').select('*').eq('facility_id', facilityId).neq('status', 'ended').order('name'),
    sb.from('staff_attendances').select('*').eq('facility_id', facilityId).gte('work_date', yesterdayKST()).lte('work_date', today),
    sb.from('staff_leave_balances').select('staff_id,granted_minutes,used_minutes')
      .eq('facility_id', facilityId).eq('leave_year', year),
    sb.from('staff_leave_requests').select('staff_id').eq('facility_id', facilityId)
      .eq('status', 'approved').lte('start_date', today).gte('end_date', today),
  ]);
  const staffIds = (staff ?? []).map((row:any)=>row.id);
  const { data: invites } = staffIds.length ? await sb.from('facility_staff_invites')
    .select('staff_id,token,expires_at').eq('facility_id',facilityId).eq('status','pending')
    .gt('expires_at',new Date().toISOString()).in('staff_id',staffIds).order('created_at',{ascending:false}) : {data:[]};
  const currentHour = Number(new Date(Date.now()+9*60*60*1000).toISOString().slice(11,13));
  const attendanceMap = new Map<string,any>();
  for (const row of (attendance ?? []) as any[]) {
    const existing=attendanceMap.get(row.staff_id);
    if(row.work_date===today || !existing){
      if(row.work_date===today || (
        row.scheduled_end <= row.scheduled_start
        && (currentHour < 12 || !row.check_out_at)
      )) attendanceMap.set(row.staff_id,row);
    }
  }
  const balanceMap = new Map((balances ?? []).map((row: any) => [row.staff_id, Math.max(0, row.granted_minutes - row.used_minutes)]));
  const inviteMap = new Map((invites ?? []).map((row:any)=>[row.staff_id,row]));
  const leaveSet = new Set((leaves ?? []).map((row: any) => row.staff_id));
  return ((staff ?? []) as any[]).map((row) => {
    const att: any = attendanceMap.get(row.id);
    const invite:any=inviteMap.get(row.id);
    return {
      id: row.id, workerId: row.worker_id, phone: row.phone, name: row.name, role: row.role, department: row.department,
      source: row.source, engagementType: row.engagement_type,
      contractStart: row.contract_start, contractEnd: row.contract_end,
      defaultStart: row.default_start_time, defaultEnd: row.default_end_time,
      status: row.status, attendanceStatus: att?.status ?? (row.status === 'leave' || leaveSet.has(row.id) ? 'leave' : 'scheduled'),
      checkInAt: att?.check_in_at ?? null, checkOutAt: att?.check_out_at ?? null,
      checkoutRequestedAt: att?.checkout_requested_at ?? null,
      workDate: att?.work_date ?? today,
      leaveMinutes: Number(balanceMap.get(row.id) ?? 0),
      inviteToken: invite?.token ?? null, inviteExpiresAt: invite?.expires_at ?? null,
      payBasis: row.pay_basis ?? null, payRate: row.pay_rate == null ? null : Number(row.pay_rate),
      bankName:row.bank_name??null,accountLast4:row.account_last4??null,
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
