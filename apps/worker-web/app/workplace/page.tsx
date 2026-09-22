'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AttendanceActionButton, type AttendanceMode, type AttendanceResult } from '@/components/attendance/AttendanceActionButton';
import { MyAttendanceCalendar } from '@/components/attendance/MyAttendanceCalendar';

type FacilityRef={id:string;name:string;registration_source?:string|null};
type Staff = { id:string; name:string; default_start_time:string; default_end_time:string; contract_start?:string|null; contract_end?:string|null; work_weekdays?:number[]|null; facilities:FacilityRef|FacilityRef[] };
type Leave = { id:string; leave_type:string; start_date:string; end_date:string; requested_minutes:number; status:string };
type AttendanceState={staff_id:string;check_in_at:string|null;check_out_at:string|null;work_date:string;status?:string;break_minutes?:number};
type ShiftAttendanceRef={checkout_requested_at:string|null};
type ShiftTarget={id:string;checked_in_at:string|null;checked_out_at:string|null;shift_attendances?:ShiftAttendanceRef|ShiftAttendanceRef[];shifts:{shift_date:string;start_time:string;end_time:string;facilities:FacilityRef|FacilityRef[]}|Array<{shift_date:string;start_time:string;end_time:string;facilities:FacilityRef|FacilityRef[]}>};
const shiftCheckoutRequested=(target:ShiftTarget)=>Array.isArray(target.shift_attendances)?target.shift_attendances[0]?.checkout_requested_at:target.shift_attendances?.checkout_requested_at;
const TYPES = [
  ['annual','연차 · 종일'],['half_day','반차 · 4시간'],['quarter_day','반반차 · 2시간'],
  ['hourly','시간차'],['sick','병가'],['other','기타'],
];
const WEEKDAY_LABEL=['월','화','수','목','금','토','일'];
function kstDate(){ return new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10); }
function isScheduledToday(staff: Staff) {
  const date=kstDate();
  if (staff.contract_start && date < staff.contract_start) return false;
  if (staff.contract_end && date > staff.contract_end) return false;
  const weekdays=staff.work_weekdays ?? [1,2,3,4,5];
  const day=new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return weekdays.includes(day);
}
function weekdayText(days?: number[]|null) {
  const sorted=(days ?? [1,2,3,4,5]).filter((day)=>day>=1&&day<=7).sort((a,b)=>a-b);
  return sorted.map((day)=>WEEKDAY_LABEL[day-1]).join('·');
}

function WorkplaceContent() {
  const params = useSearchParams();
  const legacyToken = params.get('token');
  const attendanceToken=params.get('attendanceToken');
  const [staffList,setStaffList]=useState<Staff[]>([]);
  const [selectedStaffId,setSelectedStaffId]=useState('');
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [leaveType,setLeaveType]=useState('annual');
  const [leaves,setLeaves]=useState<Leave[]>([]);
  const [leaveMinutes,setLeaveMinutes]=useState(0);
  const [attendance,setAttendance]=useState<Record<string,AttendanceState>>({});
  const [shiftTarget,setShiftTarget]=useState<ShiftTarget|null>(null);
  const [attendanceModes,setAttendanceModes]=useState<Record<string,AttendanceMode>>({});
  const [tab,setTab]=useState<'history'|'leave'>('history');
  const [refreshKey,setRefreshKey]=useState(0);

  useEffect(()=>{ void (async()=>{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){
      const query=new URLSearchParams();
      if(attendanceToken)query.set('attendanceToken',attendanceToken);
      // 로그인 후 복귀는 atman_auth_next(localStorage) 패턴 — ?next= 파라미터는 읽는 곳이 없다
      window.localStorage.setItem('atman_auth_next',`/workplace${query.size?`?${query}`:''}`);
      window.location.href='/';
      return;
    }
    const {data}=await supabase.from('facility_staff').select('id,name,default_start_time,default_end_time,contract_start,contract_end,work_weekdays,facilities(id,name,registration_source)').neq('status','ended').order('created_at',{ascending:false});
    const linked=(data??[]) as Staff[];
    const hasGigworker=linked.some((item)=>{
      const facility=Array.isArray(item.facilities)?item.facilities[0]:item.facilities;
      return facility?.registration_source==='gigworker_trial';
    });
    if(hasGigworker){
      window.localStorage.setItem('atman_gigworker_mode','1');
      window.dispatchEvent(new Event('atman:workplace-linked'));
    }
    setStaffList(linked);
    setSelectedStaffId(linked[0]?.id??'');
    if(linked.length){
      const facilityIds=[...new Set(linked.map(item=>Array.isArray(item.facilities)?item.facilities[0]?.id:item.facilities?.id).filter(Boolean))] as string[];
      const {data:settings}=await supabase.from('facility_attendance_settings').select('facility_id,authentication_mode').in('facility_id',facilityIds);
      setAttendanceModes(Object.fromEntries((settings??[]).map(row=>[row.facility_id,row.authentication_mode as AttendanceMode])));
      const kstNow=new Date(Date.now()+9*60*60*1000);
      const since=new Date(Date.UTC(kstNow.getUTCFullYear(),kstNow.getUTCMonth(),1)).toISOString().slice(0,10);
      const todayStr=kstNow.toISOString().slice(0,10);
      const {data:records}=await supabase.from('staff_attendances').select('staff_id,check_in_at,check_out_at,work_date,status,break_minutes').in('staff_id',linked.map(item=>item.id)).gte('work_date',since).order('work_date',{ascending:false});
      const map:Record<string,AttendanceState>={};
      // "오늘" 상태는 오늘 기록 우선 — 어제 퇴근 완료 기록이 오늘 출근 버튼을 가리면 안 된다.
      // 단, 야간 근무는 서버가 어제 날짜(work_date)로 적재하므로 '출근했고 아직 퇴근 전'인 어제 행은 오늘 상태로 본다.
      const rows=(records??[]) as AttendanceState[];
      for(const row of rows)if(!map[row.staff_id]&&row.work_date===todayStr)map[row.staff_id]=row;
      for(const row of rows)if(!map[row.staff_id]&&row.check_in_at&&!row.check_out_at)map[row.staff_id]=row;
      setAttendance(map);
    }
    // 단기 시프트도 QR 진입 여부와 관계없이 오늘 배정을 불러온다.
    // 그래야 워커가 앱을 직접 열어 GPS/Wi-Fi로 출퇴근할 수 있다.
    const today=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
    const {data:worker}=await supabase.from('workers').select('id').eq('auth_user_id',user.id).maybeSingle();
    if(worker){
      // 오늘 확정 근무 + 어제 시작한 야간 근무(아직 퇴근 전) + 오늘 완료한 근무(완료 문구용)
      const yesterday=new Date(Date.now()+9*60*60*1000-24*60*60*1000).toISOString().slice(0,10);
      const {data:applications}=await supabase.from('shift_applications')
        .select('id,checked_in_at,checked_out_at,status,shift_attendances(checkout_requested_at),shifts!inner(shift_date,start_time,end_time,facilities(id,name))')
        .eq('worker_id',worker.id).in('status',['accepted','completed']).in('shifts.shift_date',[yesterday,today]).limit(10);
      const list=((applications??[]) as unknown as Array<ShiftTarget&{status:string}>);
      const dateOf=(t:ShiftTarget)=>(Array.isArray(t.shifts)?t.shifts[0]:t.shifts).shift_date;
      const application=list.find(t=>t.status==='accepted'&&!t.checked_out_at&&dateOf(t)===today)
        ??list.find(t=>t.status==='accepted'&&t.checked_in_at&&!t.checked_out_at)
        ??list.find(t=>t.status==='completed'&&dateOf(t)===today)??null;
      if(application){
        const target=application as unknown as ShiftTarget;
        setShiftTarget(target);
        const shift=Array.isArray(target.shifts)?target.shifts[0]:target.shifts;
        const facility=Array.isArray(shift.facilities)?shift.facilities[0]:shift.facilities;
        if(facility?.id){
          const {data:setting}=await supabase.from('facility_attendance_settings').select('authentication_mode').eq('facility_id',facility.id).maybeSingle();
          if(setting)setAttendanceModes(current=>({...current,[facility.id]:setting.authentication_mode as AttendanceMode}));
        }
      }
    }
    if(legacyToken) setMessage('이전 정적 QR은 운영 종료됐어요. 사업장 관리자 화면의 동적 QR을 다시 스캔해 주세요.');
    setLoading(false);
  })();},[legacyToken,attendanceToken]);

  async function requestLeave(formData:FormData){
    setMessage('');
    const type=String(formData.get('leave_type'));
    const {error}=await supabase.rpc('submit_staff_leave_request_v2',{
      p_staff_id:selectedStaffId,
      p_leave_type:type,p_start_date:String(formData.get('start_date')),
      p_end_date:String(formData.get('end_date')||formData.get('start_date')),
      p_hourly_minutes:type==='hourly'?Number(formData.get('hourly_minutes')):null,
      p_reason:String(formData.get('reason')||''),
    });
    setMessage(error?error.message.replace(/^.*?: /,''):'휴가 신청을 보냈어요. 관리자 승인 후 차감됩니다.');
    if(!error) window.setTimeout(()=>window.location.reload(),700);
  }

  async function cancelLeave(id:string){
    setMessage('');
    const {error}=await supabase.rpc('cancel_staff_leave_request',{p_request_id:id});
    if(error){setMessage(error.message.replace(/^.*?: /,''));return;}
    setLeaves(current=>current.map(item=>item.id===id?{...item,status:'cancelled'}:item));
    setMessage('휴가 신청을 취소했어요. 기록은 내역에 남아 있습니다.');
  }

  useEffect(()=>{void (async()=>{
    if(!selectedStaffId){setLeaveMinutes(0);setLeaves([]);return;}
    const year=new Date().getFullYear();
    const [{data:balance},{data:requests}]=await Promise.all([
      supabase.from('staff_leave_balances').select('granted_minutes,used_minutes').eq('staff_id',selectedStaffId).eq('leave_year',year).maybeSingle(),
      supabase.from('staff_leave_requests').select('id,leave_type,start_date,end_date,requested_minutes,status').eq('staff_id',selectedStaffId).order('created_at',{ascending:false}).limit(5),
    ]);
    setLeaveMinutes(Math.max(0,Number(balance?.granted_minutes??0)-Number(balance?.used_minutes??0)));
    setLeaves((requests??[]) as Leave[]);
  })();},[selectedStaffId]);

  const staff=staffList.find(item=>item.id===selectedStaffId)??staffList[0]??null;
  const staffFacility=staff ? (Array.isArray(staff.facilities)?staff.facilities[0]:staff.facilities) : null;
  const facility=staffFacility?.name??'';
  const isGigworker=staffFacility?.registration_source==='gigworker_trial';
  const staffAttendanceMode=staffFacility?.id?attendanceModes[staffFacility.id]??'gps_or_qr':'gps_or_qr';
  const currentAttendance=staff?attendance[staff.id]:null;
  const canRecordStaffAttendance=Boolean(currentAttendance?.check_in_at)||Boolean(staff&&isScheduledToday(staff));
  return <main className="min-h-screen bg-bg px-4 pt-5 pb-28">
    {isGigworker?<section className="rounded-3xl bg-ink px-5 py-5 text-white shadow-btn"><div className="flex items-center justify-between gap-3"><span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em]">GIG WORKER</span><span className="text-[15px] font-extrabold text-primary">잇닿 GIG</span></div><h1 className="mt-5 text-[27px] font-extrabold">오늘 근무</h1><p className="mt-1 text-[13px] leading-5 text-white/65">초대받은 일정과 출퇴근 기록만 간단하게 확인해요.</p></section>:<><p className="text-[13px] font-bold text-primary">내 직장</p><h1 className="text-[26px] font-extrabold text-ink mt-1">출퇴근·휴가</h1></>}
    {loading?<div className="mt-6 bg-white rounded-2xl p-8 text-center text-sub">근태를 확인하고 있어요...</div>:
      <>{shiftTarget&&(()=>{const shift=Array.isArray(shiftTarget.shifts)?shiftTarget.shifts[0]:shiftTarget.shifts;const facility=Array.isArray(shift.facilities)?shift.facilities[0]:shift.facilities;const mode=attendanceModes[facility?.id]??'gps_or_qr';const action=shiftTarget.checked_in_at?'check_out':'check_in';const checkoutPending=Boolean(shiftCheckoutRequested(shiftTarget)&&!shiftTarget.checked_out_at);return <><section className="mt-6 rounded-2xl bg-white p-5 shadow-sm"><p className="text-[13px] font-bold text-primary">오늘 확정된 단기근무</p><h2 className="mt-1 text-[18px] font-extrabold">{facility?.name}</h2><p className="mt-1 text-[13px] text-sub">{shift.shift_date} · {shift.start_time.slice(0,5)}~{shift.end_time.slice(0,5)}</p>{checkoutPending?<p className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] font-bold text-amber-700">조기 퇴근 승인 대기 중이에요. 관리자가 승인하면 근무시간과 지급 자료가 확정됩니다.</p>:!shiftTarget.checked_out_at?<AttendanceActionButton key={action} targetType="shift" targetId={shiftTarget.id} action={action} qrToken={attendanceToken} mode={mode} onSuccess={(response)=>{setShiftTarget(current=>current?response.status==='pending'?{...current,shift_attendances:{checkout_requested_at:new Date().toISOString()}}:{...current,[action==='check_in'?'checked_in_at':'checked_out_at']:new Date().toISOString()}:current);setRefreshKey(k=>k+1);}}/>:<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-[13px] font-bold text-emerald-700">근무가 완료됐어요.</p>}</section>{!staff&&<section className="mt-5 rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-[18px] font-extrabold">내 근태 내역</h2><div className="mt-3"><MyAttendanceCalendar staffId={null} refreshKey={refreshKey}/></div></section>}</>})()}
      {      !staff?(!shiftTarget&&<div className="mt-6 bg-white rounded-2xl p-8 text-center"><b>오늘 배정된 근무가 없어요</b><p className="text-[13px] text-sub mt-2">단기 근무는 지원이 확정되면 여기에 출근 버튼이 생겨요. 사업장 직원이라면 관리자에게 잇닿 계정 연결을 요청해 주세요.</p></div>):
      <>
        <section className="mt-5 bg-white rounded-2xl p-5 shadow-sm"><p className="font-extrabold text-[18px]">{facility}</p><p className="text-[13px] text-sub mt-1">{staff.name} · 기본 근무 {staff.default_start_time.slice(0,5)}~{staff.default_end_time.slice(0,5)}</p>
          {isGigworker&&<div className="mt-3 rounded-xl bg-primary/5 px-3 py-3 text-[12px] text-sub"><p><b className="text-primary">근무 기간</b> · {staff.contract_start??'시작일 미정'} ~ {staff.contract_end??'종료일 미정'}</p><p className="mt-1"><b className="text-primary">근무 요일</b> · {weekdayText(staff.work_weekdays)}</p></div>}
          {staffList.length>1&&<label className="block mt-4 text-[12px] text-sub">{isGigworker?'근무지 선택':'관리할 직장'}<select value={selectedStaffId} onChange={e=>setSelectedStaffId(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-3">{staffList.map(item=>{const name=Array.isArray(item.facilities)?item.facilities[0]?.name:item.facilities?.name;return <option key={item.id} value={item.id}>{name??'사업장'} · {item.name}</option>;})}</select></label>}
          <div className="mt-4 rounded-xl bg-bg p-3"><p className="text-[12px] font-bold text-primary">{currentAttendance?.check_in_at?'현재 근무 중':canRecordStaffAttendance?'출근 전':'오늘은 근무 없음'}</p><p className="mt-1 text-[13px] text-sub">{isGigworker?'근무지 반경 안에서 버튼을 누르면 GPS 위치를 확인해 출퇴근을 기록해요.':'버튼 한 번으로 사업장 위치를 확인해요. 실내에서 위치가 불안정하면 사업장의 동적 QR로 인증할 수 있어요.'}</p></div>
          {!currentAttendance?.check_out_at&&currentAttendance?.status!=='checkout_pending'&&canRecordStaffAttendance&&<AttendanceActionButton key={currentAttendance?.check_in_at?'check_out':'check_in'} targetType="staff" targetId={staff.id} action={currentAttendance?.check_in_at?'check_out':'check_in'} qrToken={attendanceToken} mode={staffAttendanceMode} onSuccess={(response:AttendanceResult)=>{const now=new Date().toISOString();const checkingOut=Boolean(currentAttendance?.check_in_at);setAttendance(current=>({...current,[staff.id]:{...(current[staff.id]??{staff_id:staff.id,work_date:kstDate(),check_in_at:null,check_out_at:null}),...(checkingOut?(response.status==='pending'?{status:'checkout_pending'}:{check_out_at:response.checkOutAt??now,status:'completed'}):{check_in_at:response.checkInAt??now,status:'working'})}}));setRefreshKey(k=>k+1);}}/>}
          {currentAttendance?.status==='checkout_pending'&&<p className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] font-bold text-amber-700">조기 퇴근 승인 대기 중이에요. 관리자가 승인하면 근무시간이 확정됩니다.</p>}
          {currentAttendance?.check_out_at&&<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-[13px] font-bold text-emerald-700">오늘 출퇴근이 완료됐어요.</p>}
          {attendanceToken&&<p className="mt-2 text-center text-[11px] font-bold text-primary">동적 QR을 확인했어요. 위치 확인 후 사업장 정책에 맞게 인증합니다.</p>}
        </section>
        {!isGigworker&&<nav aria-label="직장 업무" className="mt-5 grid grid-cols-2 rounded-2xl bg-white p-1.5 shadow-sm">
          <button type="button" onClick={()=>setTab('history')} aria-pressed={tab==='history'} className={`h-11 rounded-xl text-[13px] font-extrabold ${tab==='history'?'bg-primary text-white':'text-sub'}`}>근태 내역</button>
          <button type="button" onClick={()=>setTab('leave')} aria-pressed={tab==='leave'} className={`h-11 rounded-xl text-[13px] font-extrabold ${tab==='leave'?'bg-primary text-white':'text-sub'}`}>휴가 신청</button>
        </nav>}
        {tab==='history'&&<section id="history" className="mt-3 scroll-mt-5 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-[18px] font-extrabold">내 근태 내역</h2>
          <div className="mt-3"><MyAttendanceCalendar staffId={staff.id} refreshKey={refreshKey}/></div>
          <p className="mt-3 text-[11px] leading-5 text-sub">수정이 필요한 기록은 사업장 관리자에게 요청하세요. 월 마감 후에는 급여 자료에 반영됩니다.</p>
        </section>}
        {!isGigworker&&tab==='leave'&&<section className="mt-3 bg-white rounded-2xl p-5 shadow-sm"><div className="flex justify-between items-start"><div><h2 className="font-extrabold text-[18px]">휴가 신청</h2><p className="text-[12px] text-sub mt-1">승인된 경우에만 잔여 휴가가 차감돼요.</p></div><div className="text-right"><p className="text-[11px] text-sub">잔여</p><b className="text-primary">{leaveMinutes/60}시간</b></div></div>
          <form action={requestLeave} className="grid grid-cols-2 gap-3 mt-4">
            <label className="col-span-2 text-[12px] text-sub">유형<select name="leave_type" value={leaveType} onChange={e=>setLeaveType(e.target.value)} className="mt-1 w-full h-12 border border-line rounded-xl px-3 bg-white">{TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
            {leaveType==='hourly'&&<label className="col-span-2 text-[12px] text-sub">사용 시간<select name="hourly_minutes" className="mt-1 w-full h-12 border border-line rounded-xl px-3 bg-white">{[1,2,3,4,5,6,7].map(h=><option key={h} value={h*60}>{h}시간</option>)}</select></label>}
            <label className="text-[12px] text-sub">시작일<input name="start_date" type="date" required className="mt-1 w-full h-12 border border-line rounded-xl px-2"/></label>
            <label className="text-[12px] text-sub">종료일<input name="end_date" type="date" className="mt-1 w-full h-12 border border-line rounded-xl px-2"/></label>
            <label className="col-span-2 text-[12px] text-sub">사유<input name="reason" className="mt-1 w-full h-12 border border-line rounded-xl px-3" placeholder="선택 입력"/></label>
            <button className="col-span-2 h-12 rounded-xl bg-primary text-white font-bold">관리자에게 신청</button>
          </form>
          {leaves.length>0&&<div className="mt-5 border-t border-line pt-4"><p className="text-[13px] font-bold">최근 신청</p><div className="mt-2 divide-y divide-line">{leaves.map(l=><div key={l.id} className="flex items-center justify-between gap-2 py-2.5 text-[12px]"><span>{l.start_date}{l.end_date!==l.start_date?`~${l.end_date.slice(5)}`:''} · {l.requested_minutes/60}시간</span><span className="flex items-center gap-2"><b className={l.status==='approved'?'text-success':l.status==='rejected'?'text-red-600':l.status==='cancelled'?'text-sub':'text-amber-600'}>{l.status==='approved'?'승인':l.status==='rejected'?'반려':l.status==='cancelled'?'취소됨':'대기'}</b>{l.status==='pending'&&<button type="button" onClick={()=>void cancelLeave(l.id)} className="rounded-lg border border-line px-2 py-1 text-[11px] font-bold text-sub">취소</button>}</span></div>)}</div></div>}
        </section>}
      </>}
      </>}
    {message&&<p role="status" className="mt-4 rounded-xl bg-white border border-line p-3 text-[13px] font-bold">{message}</p>}
  </main>;
}

export default function WorkplacePage(){
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">직장 정보를 불러오고 있어요...</main>}><WorkplaceContent/></Suspense>;
}
