import { adminClient } from '../supabase';
import { getCurrentFacilityId } from '../facility';
import { todayKST } from '../date';

export type GigOperationStatus = 'invite'|'scheduled'|'late'|'working'|'review'|'completed'|'bank'|'pay'|'paid'|'off';

export type GigOperationWorker = {
  staffId: string;
  assignmentId: string | null;
  name: string;
  title: string;
  workerLinked: boolean;
  invitePending: boolean;
  startTime: string;
  endTime: string;
  status: GigOperationStatus;
  statusLabel: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  bankShared: boolean;
  unpaidDays: number;
  unreadMessages: number;
  nextDate: string | null;
};

export type GigScheduleDay = {
  date: string;
  dayLabel: string;
  dateLabel: string;
  workers: Array<{ staffId: string; name: string; title: string; startTime: string; endTime: string }>;
};

export type GigOperationsBoard = {
  today: string;
  workers: GigOperationWorker[];
  days: GigScheduleDay[];
  summary: { invite: number; working: number; issue: number; pay: number };
};

type AssignmentRow = {
  id: string; staff_id: string; title: string; starts_on: string; ends_on: string;
  work_weekdays: number[]; start_time: string; end_time: string; status: string;
};

function addDays(date: string, days: number) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
function weekday(date: string) { return new Date(`${date}T00:00:00Z`).getUTCDay() || 7; }
function assignmentOn(rows: AssignmentRow[], date: string) {
  return rows.find((row) => ['planned','active'].includes(row.status) && row.starts_on <= date && row.ends_on >= date && row.work_weekdays.map(Number).includes(weekday(date))) ?? null;
}

// 모바일 관리자 첫 화면용 읽기 모델. 여러 화면에서 따로 읽던 초대·근무·근태·계좌·지급·대화를 한 번에 묶는다.
export async function getGigOperationsBoard(adminUserId?: string): Promise<GigOperationsBoard> {
  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  const today = todayKST();
  const empty: GigOperationsBoard = { today, workers: [], days: [], summary: { invite: 0, working: 0, issue: 0, pay: 0 } };
  if (!sb || !facilityId) return empty;
  const until = addDays(today, 6);

  const { data: staffRows, error: staffError } = await sb.from('facility_staff')
    .select('id,name,worker_id,department,default_start_time,default_end_time,contract_start')
    .eq('facility_id', facilityId).neq('status', 'ended').order('name');
  if (staffError) throw new Error('긱워커 운영 현황을 불러오지 못했어요.');
  const staffIds = (staffRows ?? []).map((row) => row.id as string);
  if (staffIds.length === 0) return empty;

  const [assignmentResult,attendanceResult,inviteResult,bankResult,payoutResult,messageResult,readResult,graceResult] = await Promise.all([
    sb.from('gig_assignments').select('id,staff_id,title,starts_on,ends_on,work_weekdays,start_time,end_time,status')
      .eq('facility_id', facilityId).lte('starts_on', until).gte('ends_on', today).in('status', ['planned','active']).order('starts_on'),
    sb.from('staff_attendances').select('staff_id,work_date,status,check_in_at,check_out_at')
      .eq('facility_id', facilityId).in('staff_id', staffIds).gte('work_date', addDays(today, -31)).lte('work_date', today),
    sb.from('facility_staff_invites').select('staff_id').eq('facility_id', facilityId).eq('status', 'pending').gt('expires_at', new Date().toISOString()).in('staff_id', staffIds),
    sb.from('gig_bank_account_shares').select('staff_id').eq('facility_id', facilityId).in('staff_id', staffIds),
    sb.from('gig_payouts').select('staff_id,period_end,status').eq('facility_id', facilityId).neq('status', 'cancelled').in('staff_id', staffIds).order('period_end', { ascending: false }),
    sb.from('facility_workroom_messages').select('staff_id,created_at,sender_user_id').eq('facility_id', facilityId).in('staff_id', staffIds).order('created_at', { ascending: false }).limit(500),
    adminUserId ? sb.from('facility_workroom_thread_reads').select('staff_id,last_read_at').eq('facility_id', facilityId).eq('user_id', adminUserId) : Promise.resolve({ data: [] }),
    // '미출근 확인'은 시설의 지각 유예를 지난 뒤에만 띄운다 — 정각에 바로 빨간 표시가 뜨면 사장님이 매번 헛걸음한다
    sb.from('facility_attendance_settings').select('late_grace_minutes').eq('facility_id', facilityId).maybeSingle(),
  ]);
  const failed = [assignmentResult.error, attendanceResult.error, inviteResult.error, bankResult.error, payoutResult.error, messageResult.error, 'error' in readResult ? readResult.error : null, graceResult.error].find(Boolean);
  if (failed) throw new Error('긱워커 운영 데이터를 한 번에 불러오지 못했어요.');

  const assignments = (assignmentResult.data ?? []) as AssignmentRow[];
  const assignmentsByStaff = new Map<string, AssignmentRow[]>();
  for (const row of assignments) (assignmentsByStaff.get(row.staff_id) ?? assignmentsByStaff.set(row.staff_id, []).get(row.staff_id)!).push(row);
  const attendances = (attendanceResult.data ?? []) as Array<{ staff_id:string;work_date:string;status:string;check_in_at:string|null;check_out_at:string|null }>;
  const todayAttendance = new Map(attendances.filter((row) => row.work_date === today).map((row) => [row.staff_id, row]));
  const inviteSet = new Set((inviteResult.data ?? []).map((row) => row.staff_id as string));
  const bankSet = new Set((bankResult.data ?? []).map((row) => row.staff_id as string));
  const payouts = (payoutResult.data ?? []) as Array<{staff_id:string;period_end:string;status:string}>;
  const lastPaidEnd = new Map<string,string>();
  const scheduledPayout = new Set<string>();
  for (const row of payouts) {
    if (!lastPaidEnd.has(row.staff_id)) lastPaidEnd.set(row.staff_id,row.period_end);
    if (row.status === 'scheduled') scheduledPayout.add(row.staff_id);
  }
  // 미정산 일수는 지급 페이지(lib/db/gig-payouts.ts)와 같은 기준으로 센다: 마지막 지급 다음날, 없으면 계약 시작일부터.
  // 위 attendances 는 오늘 상태용 31일 창이라 그대로 쓰면 한 달 넘게 안 준 근무가 빠진다.
  const unpaidSince = new Map<string,string>();
  for (const staff of staffRows ?? []) {
    const last = lastPaidEnd.get(staff.id as string);
    unpaidSince.set(staff.id as string, last ? addDays(last, 1) : ((staff.contract_start as string | null) ?? '2020-01-01'));
  }
  const earliestSince = [...unpaidSince.values()].sort()[0] ?? today;
  const { data: completedRows, error: completedError } = await sb.from('staff_attendances').select('staff_id,work_date')
    .eq('facility_id', facilityId).in('staff_id', staffIds).eq('status', 'completed').gte('work_date', earliestSince).lte('work_date', today);
  if (completedError) throw new Error('긱워커 미정산 근무를 불러오지 못했어요.');
  const unpaidDays = new Map<string,Set<string>>();
  for (const row of (completedRows ?? []) as Array<{ staff_id: string; work_date: string }>) {
    if (row.work_date < (unpaidSince.get(row.staff_id) ?? '2020-01-01')) continue;
    (unpaidDays.get(row.staff_id) ?? unpaidDays.set(row.staff_id,new Set()).get(row.staff_id)!).add(row.work_date);
  }
  const readAt = new Map(((readResult.data ?? []) as Array<{staff_id:string;last_read_at:string}>).map((row) => [row.staff_id,row.last_read_at]));
  const unread = new Map<string,number>();
  for (const row of (messageResult.data ?? []) as Array<{staff_id:string|null;created_at:string;sender_user_id:string|null}>) {
    if (!row.staff_id || row.sender_user_id === adminUserId || row.created_at <= (readAt.get(row.staff_id) ?? '1900-01-01')) continue;
    unread.set(row.staff_id,(unread.get(row.staff_id) ?? 0)+1);
  }

  const nowKst = new Date(Date.now()+9*60*60*1000).toISOString().slice(11,16);
  // 시설 설정이 없으면 DB 기본값(20분)과 같게 — lib/actions/clinic-workforce.ts DEFAULT_LATE_GRACE_MINUTES 와 동일
  const lateGraceMinutes = Math.max(0, Number(graceResult.data?.late_grace_minutes ?? 20));
  const toMinutes = (hhmm: string) => Number(hhmm.slice(0,2)) * 60 + Number(hhmm.slice(3,5));
  const workers: GigOperationWorker[] = (staffRows ?? []).map((staff) => {
    const rows = assignmentsByStaff.get(staff.id) ?? [];
    const assignment = assignmentOn(rows,today);
    const next = rows.flatMap((row) => Array.from({length:7},(_,index)=>addDays(today,index)).filter((date)=>assignmentOn([row],date)).map((date)=>({date,row}))).sort((a,b)=>a.date.localeCompare(b.date))[0] ?? null;
    const attendance = todayAttendance.get(staff.id);
    const linked = Boolean(staff.worker_id);
    const bankShared = bankSet.has(staff.id);
    const due = unpaidDays.get(staff.id)?.size ?? 0;
    let status: GigOperationStatus = 'off'; let statusLabel = next ? `${next.date.slice(5).replace('-','/')} 예정` : '일정 없음';
    if (!linked) { status='invite';statusLabel=inviteSet.has(staff.id)?'초대 수락 대기':'초대 필요'; }
    else if (attendance?.status === 'checkout_pending' || attendance?.status === 'absent') { status='review';statusLabel=attendance.status==='absent'?'결근 확인':'조기 퇴근 승인'; }
    else if (attendance?.status === 'working' || attendance?.status === 'late') { status='working';statusLabel=attendance.status==='late'?'지각 · 근무 중':'근무 중'; }
    else if (attendance?.status === 'completed') {
      if (scheduledPayout.has(staff.id)) { status='paid';statusLabel='지급 예정'; }
      else if (!bankShared) { status='bank';statusLabel='계좌 전달 대기'; }
      else if (due > 0) { status='pay';statusLabel='지급 확인 필요'; }
      else { status='completed';statusLabel='오늘 근무 완료'; }
    } else if (scheduledPayout.has(staff.id)) { status='paid';statusLabel='지급 예정'; }
    else if (assignment) {
      const late = toMinutes(nowKst) > toMinutes(assignment.start_time.slice(0,5)) + lateGraceMinutes && !attendance?.check_in_at;
      status=late?'late':'scheduled';statusLabel=late?'미출근 확인':'출근 예정';
    }
    return {
      staffId: staff.id,assignmentId: assignment?.id ?? next?.row.id ?? null,name: staff.name,
      title: assignment?.title ?? next?.row.title ?? staff.department ?? '단기 근무',workerLinked:linked,invitePending:inviteSet.has(staff.id),
      startTime:(assignment?.start_time ?? next?.row.start_time ?? staff.default_start_time).slice(0,5),
      endTime:(assignment?.end_time ?? next?.row.end_time ?? staff.default_end_time).slice(0,5),
      status,statusLabel,checkInAt:attendance?.check_in_at ?? null,checkOutAt:attendance?.check_out_at ?? null,
      bankShared,unpaidDays:due,unreadMessages:unread.get(staff.id) ?? 0,nextDate:next?.date ?? null,
    };
  }).sort((a,b) => {
    const priority:Record<GigOperationStatus,number>={review:0,late:1,pay:2,bank:3,invite:4,working:5,scheduled:6,completed:7,paid:8,off:9};
    return priority[a.status]-priority[b.status] || a.startTime.localeCompare(b.startTime) || a.name.localeCompare(b.name);
  });

  const dayLabels=['일','월','화','수','목','금','토'];
  const days: GigScheduleDay[] = Array.from({length:7},(_,index)=>{
    const date=addDays(today,index);
    const rows=(staffRows ?? []).flatMap((staff)=>{
      const assignment=assignmentOn(assignmentsByStaff.get(staff.id) ?? [],date);
      return assignment?[{staffId:staff.id,name:staff.name,title:assignment.title,startTime:assignment.start_time.slice(0,5),endTime:assignment.end_time.slice(0,5)}]:[];
    }).sort((a,b)=>a.startTime.localeCompare(b.startTime));
    return {date,dayLabel:dayLabels[new Date(`${date}T00:00:00Z`).getUTCDay()],dateLabel:`${Number(date.slice(5,7))}/${Number(date.slice(8,10))}`,workers:rows};
  });
  return {today,workers,days,summary:{
    invite:workers.filter((row)=>row.status==='invite').length,
    working:workers.filter((row)=>['scheduled','working','completed'].includes(row.status)).length,
    issue:workers.filter((row)=>row.status==='review'||row.status==='late').length,
    pay:workers.filter((row)=>row.status==='pay'||row.status==='bank').length,
  }};
}
