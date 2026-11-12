import { isGigStaff, isGigworkerFacility } from '@/lib/facility-mode';
import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST, yesterdayKST } from '../date';
import { normalizeWeekdayHours, staffHoursOn, type WeekdayHours } from '../staff-schedule';
import { loadWorkerBanks, resolveStaffBank, type StaffBankSource } from '../staff-bank';

export type ClinicStaff = {
  id: string;
  workerId: string | null;
  phone: string | null;
  name: string;
  role: string;
  department: string | null;
  source: 'direct' | 'atman' | 'imported';
  engagementType: 'regular' | 'fixed_term' | 'temporary' | 'daily';
  workerKind: 'staff' | 'gig';
  contractStart: string | null;
  contractEnd: string | null;
  workWeekdays: number[];
  scheduledToday: boolean;
  defaultStart: string;
  defaultEnd: string;
  // 요일과 무관한 기본 시간과 요일별 예외. defaultStart/defaultEnd 는 '그 근무일'에 적용되는 시간이다.
  baseStart: string;
  baseEnd: string;
  weekdayHours: WeekdayHours;
  hireDate: string | null;
  defaultBreakMinutes: number;
  status: 'active' | 'leave' | 'ended';
  attendanceStatus: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkoutRequestedAt: string | null;
  workDate: string;
  leaveMinutes: number;
  /** 올해 부여·사용한 휴가(분). 부여 기록이 없으면 null — 화면에서 '부여 전'으로 구분한다 */
  leaveGrantedMinutes: number | null;
  leaveUsedMinutes: number;
  accountName: string | null;
  inviteToken: string | null;
  inviteExpiresAt: string | null;
  payBasis: 'monthly'|'hourly'|'daily'|null;
  payRate: number|null;
  bankName:string|null;
  accountLast4:string|null;
  /** worker = 근무자가 앱에 등록한 계좌, facility = 사업장이 넣은 확인용 값, none = 없음 (lib/staff-bank.ts) */
  bankSource:StaffBankSource;
  /** 앱 연결 직원인데 근무자 앱에 아직 지급 계좌가 없는지 */
  workerBankMissing:boolean;
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
  const [staffResult, attendanceResult, balanceResult, leaveResult, facilityResult, assignmentResult] = await Promise.all([
    sb.from('facility_staff').select('*, workers!worker_id(name)').eq('facility_id', facilityId).neq('status', 'ended').order('name'),
    sb.from('staff_attendances').select('*').eq('facility_id', facilityId).gte('work_date', yesterdayKST()).lte('work_date', today),
    sb.from('staff_leave_balances').select('staff_id,granted_minutes,used_minutes')
      .eq('facility_id', facilityId).eq('leave_year', year),
    sb.from('staff_leave_requests').select('staff_id').eq('facility_id', facilityId)
      .eq('status', 'approved').lte('start_date', today).gte('end_date', today),
    sb.from('facilities').select('facility_type,registration_source').eq('id', facilityId).maybeSingle(),
    sb.from('gig_assignments').select('id,staff_id,title,starts_on,ends_on,work_weekdays,start_time,end_time,pay_basis,pay_rate,status,source')
      .eq('facility_id',facilityId).lte('starts_on',today).gte('ends_on',today).neq('status','cancelled').order('source'),
  ]);
  const loadError = [staffResult.error, attendanceResult.error, balanceResult.error, leaveResult.error, facilityResult.error, assignmentResult.error].find(Boolean);
  // 요일 일정은 긱 근무자(하루·반복 근무)에게만 근태를 가른다. 직원의 work_weekdays 는
  // 등록 기본값(월~금)이 대부분이라 주말 근무를 막는 근거가 못 된다 — DB record_unified_attendance 와 같은 기준(worker_kind).
  const facilityIsGig = isGigworkerFacility(facilityResult.data);
  if (loadError) throw new Error(`직원·근태 정보를 불러오지 못했어요: ${loadError.message}`);
  // 연결 직원의 지급 계좌는 근무자 앱 계좌가 기준 — 예전 사본(facility_staff.bank_name)은 근무자가 바꿔도 따라가지 않았다
  const workerBanks = await loadWorkerBanks(sb, ((staffResult.data ?? []) as any[]).map((row) => row.worker_id));
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
  const balanceRowMap = new Map((balances ?? []).map((row: any) => [row.staff_id, row]));
  const inviteMap = new Map((invites ?? []).map((row:any)=>[row.staff_id,row]));
  const leaveSet = new Set((leaves ?? []).map((row: any) => row.staff_id));
  const assignmentMap=new Map<string,any>();
  const todayWeekday=new Date(`${today}T00:00:00Z`).getUTCDay()||7;
  // 근무 건 참여(source='admin')가 사람별 호환 건보다 우선한다 ('admin' < 'staff_compat' 정렬이라 먼저 온다)
  const staffWithProject=new Set(((assignmentResult.data??[]) as any[]).filter((row)=>row.source==='admin').map((row)=>row.staff_id));
  for(const row of (assignmentResult.data??[]) as any[]){
    if(row.source!=='admin'&&staffWithProject.has(row.staff_id))continue;
    if((row.work_weekdays??[]).map(Number).includes(todayWeekday)&&!assignmentMap.has(row.staff_id))assignmentMap.set(row.staff_id,row);
  }
  return ((staff ?? []) as any[]).map((row) => {
    const att: any = attendanceMap.get(row.id);
    const invite:any=inviteMap.get(row.id);
    const enforceWeekdays = facilityIsGig || isGigStaff(row);
    const assignment:any=enforceWeekdays?assignmentMap.get(row.id):null;
    const workWeekdays=(assignment?.work_weekdays??row.work_weekdays??[1,2,3,4,5]).map(Number);
    const inContract=assignment?true:(!row.contract_start||row.contract_start<=today)&&(!row.contract_end||row.contract_end>=today);
    const hasOpenAttendance=Boolean(att?.check_in_at&&!att?.check_out_at);
    const scheduledToday=row.status==='active'&&inContract&&(!enforceWeekdays||Boolean(assignment));
    const dayHours=staffHoursOn({defaultStart:row.default_start_time,defaultEnd:row.default_end_time,weekdayHours:row.weekday_hours},att?.work_date??today);
    return {
      id: row.id, workerId: row.worker_id, phone: row.phone, name: row.name, role: row.role, department: assignment?.title??row.department,
      source: row.source, engagementType: row.engagement_type, workerKind: isGigStaff(row) ? 'gig' : 'staff',
      contractStart: assignment?.starts_on??row.contract_start, contractEnd: assignment?.ends_on??row.contract_end,
      workWeekdays, scheduledToday:scheduledToday||hasOpenAttendance,
      defaultStart: assignment?.start_time??dayHours.start, defaultEnd: assignment?.end_time??dayHours.end,
      baseStart: row.default_start_time, baseEnd: row.default_end_time, weekdayHours: normalizeWeekdayHours(row.weekday_hours), hireDate: row.contract_start ?? null,
      defaultBreakMinutes: Number.isInteger(row.default_break_minutes) ? row.default_break_minutes : 60,
      status: row.status, attendanceStatus: att?.status ?? (row.status === 'leave' || leaveSet.has(row.id) ? 'leave' : scheduledToday ? 'scheduled' : 'off'),
      checkInAt: att?.check_in_at ?? null, checkOutAt: att?.check_out_at ?? null,
      checkoutRequestedAt: att?.checkout_requested_at ?? null,
      workDate: att?.work_date ?? today,
      leaveMinutes: Number(balanceMap.get(row.id) ?? 0),
      leaveGrantedMinutes: balanceRowMap.has(row.id) ? Number(balanceRowMap.get(row.id).granted_minutes ?? 0) : null,
      leaveUsedMinutes: Number(balanceRowMap.get(row.id)?.used_minutes ?? 0),
      accountName: (Array.isArray(row.workers) ? row.workers[0]?.name : row.workers?.name) ?? null,
      inviteToken: invite?.token ?? null, inviteExpiresAt: invite?.expires_at ?? null,
      payBasis: assignment?.pay_basis??row.pay_basis??null, payRate: (assignment?.pay_rate??row.pay_rate) == null ? null : Number(assignment?.pay_rate??row.pay_rate),
      ...(()=>{const bank=resolveStaffBank({workerId:row.worker_id??null,bankName:row.bank_name??null,accountLast4:row.account_last4??null},row.worker_id?workerBanks.get(row.worker_id):null);
        return {bankName:bank.bankName,accountLast4:bank.accountLast4,bankSource:bank.source,workerBankMissing:Boolean(row.worker_id)&&!bank.workerHasAccount};})(),
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
  if('error' in applicationResult&&applicationResult.error)throw new Error(`단기 근무자 이름을 불러오지 못했어요: ${applicationResult.error.message}`);
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

// 답을 기다리는 휴가 신청 수 — 홈 '오늘 처리할 일'
export async function getPendingLeaveCount(): Promise<number> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return 0;
  const { count } = await sb.from('staff_leave_requests')
    .select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).eq('status', 'pending');
  return count ?? 0;
}

// 주간 근무표용 — 그 주에 걸친 휴가(승인·신청 중)
export async function getWeekLeaves(weekStart: string, weekEnd: string) {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const { data, error } = await sb.from('staff_leave_requests').select('*')
    .eq('facility_id', facilityId).in('status', ['approved', 'pending'])
    .lte('start_date', weekEnd).gte('end_date', weekStart);
  if (error) throw new Error(`휴가 정보를 불러오지 못했어요: ${error.message}`);
  return (data ?? []) as Array<{ staff_id: string; leave_type: string; start_date: string; end_date: string | null; status: string; half_day_period?: string | null }>;
}

export async function getClinicLeaveRequests() {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return [];
  const { data } = await sb.from('staff_leave_requests')
    // 열 목록 대신 * — half_day_period(반차 오전·오후) 열이 DB 에 생기기 전에도 목록이 비지 않는다
    .select('*,facility_staff(name)')
    .eq('facility_id', facilityId).order('start_date', { ascending: false }).limit(30);
  return data ?? [];
}
