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
  checkInMethod:string|null;
  checkOutMethod:string|null;
  checkInDistanceM:number|null;
  checkOutDistanceM:number|null;
  lateMinutes:number;
  earlyLeaveMinutes:number;
  adminApproved:boolean;
};

export async function getClinicStaff(): Promise<ClinicStaff[]> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const today = todayKST();
  const year = Number(today.slice(0, 4));
  const [staffResult, attendanceResult, balanceResult, leaveResult] = await Promise.all([
    sb.from('facility_staff').select('*').eq('facility_id', facilityId).neq('status', 'ended').order('name'),
    sb.from('staff_attendances').select('*').eq('facility_id', facilityId).gte('work_date', yesterdayKST()).lte('work_date', today),
    sb.from('staff_leave_balances').select('staff_id,granted_minutes,used_minutes')
      .eq('facility_id', facilityId).eq('leave_year', year),
    sb.from('staff_leave_requests').select('staff_id').eq('facility_id', facilityId)
      .eq('status', 'approved').lte('start_date', today).gte('end_date', today),
  ]);
  const loadError = [staffResult.error, attendanceResult.error, balanceResult.error, leaveResult.error].find(Boolean);
  if (loadError) throw new Error(`직원·근태 정보를 불러오지 못했어요: ${loadError.message}`);
  const staff = staffResult.data;
  const attendance = attendanceResult.data;
  const balances = balanceResult.data;
  const leaves = leaveResult.data;
  const staffIds = (staff ?? []).map((row:any)=>row.id);
  const inviteResult = staffIds.length ? await sb.from('facility_staff_invites')
    .select('staff_id,token,expires_at').eq('facility_id',facilityId).eq('status','pending')
    .gt('expires_at',new Date().toISOString()).in('staff_id',staffIds).order('created_at',{ascending:false}) : {data:[]};
  if ('error' in inviteResult && inviteResult.error) throw new Error(`직원 초대 정보를 불러오지 못했어요: ${inviteResult.error.message}`);
  const invites = inviteResult.data;
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
      checkInMethod:att?.check_in_method??null,checkOutMethod:att?.check_out_method??null,
      checkInDistanceM:att?.check_in_distance_m??null,checkOutDistanceM:att?.check_out_distance_m??null,
      lateMinutes:Number(att?.late_minutes??0),earlyLeaveMinutes:Number(att?.early_leave_minutes??0),
      adminApproved:Boolean(att?.approved_by),
    };
  });
}

export async function getTodayAttendanceFailures(){
  const facilityId=await getCurrentFacilityId();
  const sb=adminClient();
  if(!sb||!facilityId)return [];
  const today=todayKST();
  const {data,error}=await sb.from('attendance_auth_logs')
    .select('id,staff_id,application_id,target_type,action,result,authentication_method,distance_meters,gps_accuracy_meters,failure_reason,detail,created_at')
    .eq('facility_id',facilityId).in('result',['FAIL','SUCCESS'])
    .gte('created_at',`${today}T00:00:00+09:00`).order('created_at',{ascending:false}).limit(80);
  if(error)throw new Error(`인증 실패 기록을 불러오지 못했어요: ${error.message}`);
  const rawRows=(data??[]) as any[];
  // 같은 사람이 같은 출퇴근 동작을 여러 번 실패해도 관리자에게는 하나의
  // 처리 항목으로 보인다. 원본 시도 기록은 DB 감사 로그에 그대로 보존한다.
  const latestByAction=new Map<string,any>();
  for(const row of rawRows){
    const target=row.staff_id?`staff:${row.staff_id}`:row.application_id?`application:${row.application_id}`:`log:${row.id}`;
    const key=`${target}:${row.action}`;
    if(!latestByAction.has(key))latestByAction.set(key,row);
  }
  // 가장 최근 시도가 성공이면(GPS 두 번 실패 후 QR 성공 등) 관리자가 볼 일이 없다
  const rows=[...latestByAction.values()].filter(row=>row.result==='FAIL');
  const staffIds=[...new Set(rows.map(row=>row.staff_id).filter(Boolean))];
  const applicationIds=[...new Set(rows.map(row=>row.application_id).filter(Boolean))];
  const [staffResult,applicationResult]=await Promise.all([
    staffIds.length?sb.from('facility_staff').select('id,name').eq('facility_id',facilityId).in('id',staffIds):Promise.resolve({data:[]}),
    applicationIds.length?sb.from('shift_applications').select('id,workers(name)').in('id',applicationIds):Promise.resolve({data:[]}),
  ]);
  if('error' in staffResult&&staffResult.error)throw new Error(`직원 이름을 불러오지 못했어요: ${staffResult.error.message}`);
  if('error' in applicationResult&&applicationResult.error)throw new Error(`단기근로자 이름을 불러오지 못했어요: ${applicationResult.error.message}`);
  const staff=staffResult.data;
  const applications=applicationResult.data;
  const staffNames=new Map((staff??[]).map((row:any)=>[row.id,row.name]));
  const workerNames=new Map((applications??[]).map((row:any)=>[row.id,Array.isArray(row.workers)?row.workers[0]?.name:row.workers?.name]));
  return rows.map(row=>({...row,worker_name:row.staff_id?staffNames.get(row.staff_id):workerNames.get(row.application_id)}));
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
