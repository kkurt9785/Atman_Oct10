'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { AttendanceActionButton, type AttendanceMode, type AttendanceResult } from '@/components/attendance/AttendanceActionButton';
import { MyAttendanceCalendar } from '@/components/attendance/MyAttendanceCalendar';

type FacilityRef={id:string;name:string};
type Staff = { id:string; name:string; default_start_time:string; default_end_time:string; facilities:FacilityRef|FacilityRef[] };
type Result = { action:'check_in'|'check_out'; status:'approved'|'pending'; facility_name:string; staff_id:string; work_date:string };
type Leave = { id:string; leave_type:string; start_date:string; end_date:string; requested_minutes:number; status:string };
type AttendanceState={staff_id:string;check_in_at:string|null;check_out_at:string|null;work_date:string;status?:string;break_minutes?:number};
type ShiftTarget={id:string;checked_in_at:string|null;checked_out_at:string|null;shifts:{shift_date:string;start_time:string;end_time:string;facilities:FacilityRef|FacilityRef[]}|Array<{shift_date:string;start_time:string;end_time:string;facilities:FacilityRef|FacilityRef[]}>};
const TYPES = [
  ['annual','연차 · 종일'],['half_day','반차 · 4시간'],['quarter_day','반반차 · 2시간'],
  ['hourly','시간차'],['sick','병가'],['other','기타'],
];

function WorkplaceContent() {
  const params = useSearchParams();
  const token = params.get('token');
  const attendanceToken=params.get('attendanceToken');
  const [staffList,setStaffList]=useState<Staff[]>([]);
  const [selectedStaffId,setSelectedStaffId]=useState('');
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const [leaveType,setLeaveType]=useState('annual');
  const [leaves,setLeaves]=useState<Leave[]>([]);
  const [leaveMinutes,setLeaveMinutes]=useState(0);
  const [attendance,setAttendance]=useState<Record<string,AttendanceState>>({});
  const [shiftTarget,setShiftTarget]=useState<ShiftTarget|null>(null);
  const [attendanceModes,setAttendanceModes]=useState<Record<string,AttendanceMode>>({});
  const [tab,setTab]=useState<'history'|'leave'>('history');

  useEffect(()=>{ void (async()=>{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){
      const query=new URLSearchParams();
      if(token)query.set('token',token);
      if(attendanceToken)query.set('attendanceToken',attendanceToken);
      // 로그인 후 복귀는 atman_auth_next(localStorage) 패턴 — ?next= 파라미터는 읽는 곳이 없다
      window.localStorage.setItem('atman_auth_next',`/workplace${query.size?`?${query}`:''}`);
      window.location.href='/';
      return;
    }
    const {data}=await supabase.from('facility_staff').select('id,name,default_start_time,default_end_time,facilities(id,name)').neq('status','ended').order('created_at',{ascending:false});
    const linked=(data??[]) as Staff[];
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
      // "오늘" 상태는 오늘 기록만 — 어제 퇴근 기록이 오늘 출근 버튼을 가리면 안 된다
      for(const row of (records??[]) as AttendanceState[])if(!map[row.staff_id]&&row.work_date===todayStr)map[row.staff_id]=row;
      setAttendance(map);
    }
    // 단기 시프트도 QR 진입 여부와 관계없이 오늘 배정을 불러온다.
    // 그래야 워커가 앱을 직접 열어 GPS/Wi-Fi로 출퇴근할 수 있다.
    const today=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
    const {data:worker}=await supabase.from('workers').select('id').eq('auth_user_id',user.id).maybeSingle();
    if(worker){
      const {data:application}=await supabase.from('shift_applications')
        .select('id,checked_in_at,checked_out_at,shifts!inner(shift_date,start_time,end_time,facilities(id,name))')
        .eq('worker_id',worker.id).eq('status','accepted').eq('shifts.shift_date',today).limit(1).maybeSingle();
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
    if(token){
      let coords:{latitude:number;longitude:number}|null=null;
      try {
        const position=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:8000,maximumAge:30000}));
        coords=position.coords;
      } catch {
        setMessage('사업장에서 출퇴근하려면 브라우저 위치 권한을 허용해 주세요.');
        setLoading(false);
        return;
      }
      const {data:attendance,error}=await supabase.rpc('record_staff_qr_attendance',{p_token:token,p_lat:coords.latitude,p_lng:coords.longitude});
      if(error) setMessage(error.message.replace(/^.*?: /,''));
      else {
        const next=attendance as Result;
        setResult(next);
        const matched=linked.find(item=>item.id===next.staff_id);
        if(matched)setSelectedStaffId(matched.id);
      }
    }
    setLoading(false);
  })();},[token,attendanceToken]);

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
  const staffAttendanceMode=staffFacility?.id?attendanceModes[staffFacility.id]??'gps_or_qr':'gps_or_qr';
  const currentAttendance=staff?attendance[staff.id]:null;
  return <main className="min-h-screen bg-bg px-4 pt-6 pb-28">
    <p className="text-[13px] font-bold text-primary">내 직장</p><h1 className="text-[26px] font-extrabold text-ink mt-1">출퇴근·휴가</h1>
    {loading?<div className="mt-6 bg-white rounded-2xl p-8 text-center text-sub">근태를 확인하고 있어요...</div>:
      !staff&&shiftTarget?(()=>{const shift=Array.isArray(shiftTarget.shifts)?shiftTarget.shifts[0]:shiftTarget.shifts;const facility=Array.isArray(shift.facilities)?shift.facilities[0]:shift.facilities;const mode=attendanceModes[facility?.id]??'gps_or_qr';const action=shiftTarget.checked_in_at?'check_out':'check_in';return <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm"><p className="text-[13px] font-bold text-primary">오늘 확정된 단기근무</p><h2 className="mt-1 text-[18px] font-extrabold">{facility?.name}</h2><p className="mt-1 text-[13px] text-sub">{shift.shift_date} · {shift.start_time.slice(0,5)}~{shift.end_time.slice(0,5)}</p>{!shiftTarget.checked_out_at?<AttendanceActionButton key={action} targetType="shift" targetId={shiftTarget.id} action={action} qrToken={attendanceToken} mode={mode} onSuccess={(response)=>{if(response.status!=='pending')setShiftTarget(current=>current?{...current,[action==='check_in'?'checked_in_at':'checked_out_at']:new Date().toISOString()}:current);}}/>:<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-[13px] font-bold text-emerald-700">근무가 완료됐어요.</p>}</section>})():
      !staff?<div className="mt-6 bg-white rounded-2xl p-8 text-center"><b>연결된 사업장 직원 정보가 없어요</b><p className="text-[13px] text-sub mt-2">사업장 관리자에게 잇닿 계정 연결을 요청해 주세요.</p></div>:
      <>
        <section className="mt-5 bg-white rounded-2xl p-5 shadow-sm"><p className="font-extrabold text-[18px]">{facility}</p><p className="text-[13px] text-sub mt-1">{staff.name} · 기본 근무 {staff.default_start_time.slice(0,5)}~{staff.default_end_time.slice(0,5)}</p>
          {staffList.length>1&&<label className="block mt-4 text-[12px] text-sub">관리할 직장<select value={selectedStaffId} onChange={e=>setSelectedStaffId(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-3">{staffList.map(item=>{const name=Array.isArray(item.facilities)?item.facilities[0]?.name:item.facilities?.name;return <option key={item.id} value={item.id}>{name??'사업장'} · {item.name}</option>;})}</select></label>}
          {result&&<div className={`mt-4 rounded-xl p-4 ${result.status==='pending'?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'}`}><b>{result.action==='check_in'?'출근이 기록됐어요':result.status==='pending'?'조기 퇴근 승인을 요청했어요':'퇴근이 기록됐어요'}</b><p className="text-[12px] mt-1">{result.status==='pending'?'예정 퇴근시간 전이라 관리자 승인 후 확정됩니다.':'사업장 근태 기록에 바로 반영됐습니다.'}</p></div>}
          {!token&&<div className="mt-4 rounded-xl bg-bg p-3"><p className="text-[12px] font-bold text-primary">{currentAttendance?.check_in_at?'현재 근무 중':'출근 전'}</p><p className="mt-1 text-[13px] text-sub">버튼 한 번으로 사업장 위치를 확인해요. 실내에서 위치가 불안정하면 사업장의 동적 QR로 인증할 수 있어요.</p></div>}
          {!token&&!currentAttendance?.check_out_at&&currentAttendance?.status!=='checkout_pending'&&<AttendanceActionButton key={currentAttendance?.check_in_at?'check_out':'check_in'} targetType="staff" targetId={staff.id} action={currentAttendance?.check_in_at?'check_out':'check_in'} qrToken={attendanceToken} mode={staffAttendanceMode} onSuccess={(response:AttendanceResult)=>{const now=new Date().toISOString();const checkingOut=Boolean(currentAttendance?.check_in_at);setAttendance(current=>({...current,[staff.id]:{...(current[staff.id]??{staff_id:staff.id,work_date:new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10),check_in_at:null,check_out_at:null}),...(checkingOut?(response.status==='pending'?{status:'checkout_pending'}:{check_out_at:response.checkOutAt??now,status:'completed'}):{check_in_at:response.checkInAt??now,status:'working'})}}));}}/>}
          {currentAttendance?.status==='checkout_pending'&&<p className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] font-bold text-amber-700">조기 퇴근 승인 대기 중이에요. 관리자가 승인하면 근무시간이 확정됩니다.</p>}
          {currentAttendance?.check_out_at&&<p className="mt-4 rounded-xl bg-emerald-50 p-3 text-[13px] font-bold text-emerald-700">오늘 출퇴근이 완료됐어요.</p>}
          {attendanceToken&&<p className="mt-2 text-center text-[11px] font-bold text-primary">동적 QR을 확인했어요. 위치 확인 후 사업장 정책에 맞게 인증합니다.</p>}
        </section>
        <nav aria-label="직장 업무" className="mt-5 grid grid-cols-2 rounded-2xl bg-white p-1.5 shadow-sm">
          <button type="button" onClick={()=>setTab('history')} aria-pressed={tab==='history'} className={`h-11 rounded-xl text-[13px] font-extrabold ${tab==='history'?'bg-primary text-white':'text-sub'}`}>근태 내역</button>
          <button type="button" onClick={()=>setTab('leave')} aria-pressed={tab==='leave'} className={`h-11 rounded-xl text-[13px] font-extrabold ${tab==='leave'?'bg-primary text-white':'text-sub'}`}>휴가 신청</button>
        </nav>
        {tab==='history'&&<section className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-[18px] font-extrabold">내 근태 내역</h2>
          <div className="mt-3"><MyAttendanceCalendar staffId={staff.id}/></div>
          <p className="mt-3 text-[11px] leading-5 text-sub">수정이 필요한 기록은 사업장 관리자에게 요청하세요. 월 마감 후에는 급여 자료에 반영됩니다.</p>
        </section>}
        {tab==='leave'&&<section className="mt-3 bg-white rounded-2xl p-5 shadow-sm"><div className="flex justify-between items-start"><div><h2 className="font-extrabold text-[18px]">휴가 신청</h2><p className="text-[12px] text-sub mt-1">승인된 경우에만 잔여 휴가가 차감돼요.</p></div><div className="text-right"><p className="text-[11px] text-sub">잔여</p><b className="text-primary">{leaveMinutes/60}시간</b></div></div>
          <form action={requestLeave} className="grid grid-cols-2 gap-3 mt-4">
            <label className="col-span-2 text-[12px] text-sub">유형<select name="leave_type" value={leaveType} onChange={e=>setLeaveType(e.target.value)} className="mt-1 w-full h-12 border border-line rounded-xl px-3 bg-white">{TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
            {leaveType==='hourly'&&<label className="col-span-2 text-[12px] text-sub">사용 시간<select name="hourly_minutes" className="mt-1 w-full h-12 border border-line rounded-xl px-3 bg-white">{[1,2,3,4,5,6,7].map(h=><option key={h} value={h*60}>{h}시간</option>)}</select></label>}
            <label className="text-[12px] text-sub">시작일<input name="start_date" type="date" required className="mt-1 w-full h-12 border border-line rounded-xl px-2"/></label>
            <label className="text-[12px] text-sub">종료일<input name="end_date" type="date" className="mt-1 w-full h-12 border border-line rounded-xl px-2"/></label>
            <label className="col-span-2 text-[12px] text-sub">사유<input name="reason" className="mt-1 w-full h-12 border border-line rounded-xl px-3" placeholder="선택 입력"/></label>
            <button className="col-span-2 h-12 rounded-xl bg-primary text-white font-bold">관리자에게 신청</button>
          </form>
          {leaves.length>0&&<div className="mt-5 border-t border-line pt-4"><p className="text-[13px] font-bold">최근 신청</p><div className="mt-2 divide-y divide-line">{leaves.map(l=><div key={l.id} className="py-2.5 flex justify-between gap-2 text-[12px]"><span>{l.start_date}{l.end_date!==l.start_date?`~${l.end_date.slice(5)}`:''} · {l.requested_minutes/60}시간</span><b className={l.status==='approved'?'text-success':l.status==='rejected'?'text-red-600':'text-amber-600'}>{l.status==='approved'?'승인':l.status==='rejected'?'반려':'대기'}</b></div>)}</div></div>}
        </section>}
      </>}
    {message&&<p role="status" className="mt-4 rounded-xl bg-white border border-line p-3 text-[13px] font-bold">{message}</p>}
  </main>;
}

export default function WorkplacePage(){
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">직장 정보를 불러오고 있어요...</main>}><WorkplaceContent/></Suspense>;
}
