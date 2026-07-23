'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Staff = { id:string; name:string; default_start_time:string; default_end_time:string; facilities:{name:string}|Array<{name:string}> };
type Result = { action:'check_in'|'check_out'; status:'approved'|'pending'; facility_name:string; staff_id:string; work_date:string };
type Leave = { id:string; leave_type:string; start_date:string; end_date:string; requested_minutes:number; status:string };
const TYPES = [
  ['annual','연차 · 종일'],['half_day','반차 · 4시간'],['quarter_day','반반차 · 2시간'],
  ['hourly','시간차'],['sick','병가'],['other','기타'],
];

function WorkplaceContent() {
  const params = useSearchParams();
  const token = params.get('token');
  const [staffList,setStaffList]=useState<Staff[]>([]);
  const [selectedStaffId,setSelectedStaffId]=useState('');
  const [loading,setLoading]=useState(true);
  const [message,setMessage]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const [leaveType,setLeaveType]=useState('annual');
  const [leaves,setLeaves]=useState<Leave[]>([]);
  const [leaveMinutes,setLeaveMinutes]=useState(0);

  useEffect(()=>{ void (async()=>{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user){ window.location.href=`/?next=${encodeURIComponent(`/workplace${token?`?token=${token}`:''}`)}`; return; }
    const {data}=await supabase.from('facility_staff').select('id,name,default_start_time,default_end_time,facilities(name)').neq('status','ended').order('created_at',{ascending:false});
    const linked=(data??[]) as Staff[];
    setStaffList(linked);
    setSelectedStaffId(linked[0]?.id??'');
    if(token){
      let coords:{latitude:number;longitude:number}|null=null;
      try {
        const position=await new Promise<GeolocationPosition>((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:8000,maximumAge:30000}));
        coords=position.coords;
      } catch {
        setMessage('병원에서 출퇴근하려면 브라우저 위치 권한을 허용해 주세요.');
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
  })();},[token]);

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
  const facility=staff ? (Array.isArray(staff.facilities)?staff.facilities[0]?.name:staff.facilities?.name) : '';
  return <main className="min-h-screen bg-bg px-4 pt-6 pb-28">
    <p className="text-[13px] font-bold text-primary">내 직장</p><h1 className="text-[26px] font-extrabold text-ink mt-1">출퇴근·휴가</h1>
    {loading?<div className="mt-6 bg-white rounded-2xl p-8 text-center text-sub">근태를 확인하고 있어요...</div>:
      !staff?<div className="mt-6 bg-white rounded-2xl p-8 text-center"><b>연결된 병원 직원 정보가 없어요</b><p className="text-[13px] text-sub mt-2">병원 관리자에게 잇닿 계정 연결을 요청해 주세요.</p></div>:
      <>
        <section className="mt-5 bg-white rounded-2xl p-5 shadow-sm"><p className="font-extrabold text-[18px]">{facility}</p><p className="text-[13px] text-sub mt-1">{staff.name} · 기본 근무 {staff.default_start_time.slice(0,5)}~{staff.default_end_time.slice(0,5)}</p>
          {staffList.length>1&&<label className="block mt-4 text-[12px] text-sub">관리할 직장<select value={selectedStaffId} onChange={e=>setSelectedStaffId(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-line bg-white px-3">{staffList.map(item=>{const name=Array.isArray(item.facilities)?item.facilities[0]?.name:item.facilities?.name;return <option key={item.id} value={item.id}>{name??'병원'} · {item.name}</option>;})}</select></label>}
          {result&&<div className={`mt-4 rounded-xl p-4 ${result.status==='pending'?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'}`}><b>{result.action==='check_in'?'출근이 기록됐어요':result.status==='pending'?'조기 퇴근 승인을 요청했어요':'퇴근이 기록됐어요'}</b><p className="text-[12px] mt-1">{result.status==='pending'?'예정 퇴근시간 전이라 관리자 승인 후 확정됩니다.':'병원 근태 기록에 바로 반영됐습니다.'}</p></div>}
          {!token&&<p className="mt-4 rounded-xl bg-bg p-3 text-[13px] text-sub">병원에 비치된 QR을 휴대폰 기본 카메라로 스캔하면 출퇴근이 기록돼요.</p>}
        </section>
        <section className="mt-5 bg-white rounded-2xl p-5 shadow-sm"><div className="flex justify-between items-start"><div><h2 className="font-extrabold text-[18px]">휴가 신청</h2><p className="text-[12px] text-sub mt-1">승인된 경우에만 잔여 휴가가 차감돼요.</p></div><div className="text-right"><p className="text-[11px] text-sub">잔여</p><b className="text-primary">{leaveMinutes/60}시간</b></div></div>
          <form action={requestLeave} className="grid grid-cols-2 gap-3 mt-4">
            <label className="col-span-2 text-[12px] text-sub">유형<select name="leave_type" value={leaveType} onChange={e=>setLeaveType(e.target.value)} className="mt-1 w-full h-12 border border-line rounded-xl px-3 bg-white">{TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
            {leaveType==='hourly'&&<label className="col-span-2 text-[12px] text-sub">사용 시간<select name="hourly_minutes" className="mt-1 w-full h-12 border border-line rounded-xl px-3 bg-white">{[1,2,3,4,5,6,7].map(h=><option key={h} value={h*60}>{h}시간</option>)}</select></label>}
            <label className="text-[12px] text-sub">시작일<input name="start_date" type="date" required className="mt-1 w-full h-12 border border-line rounded-xl px-2"/></label>
            <label className="text-[12px] text-sub">종료일<input name="end_date" type="date" className="mt-1 w-full h-12 border border-line rounded-xl px-2"/></label>
            <label className="col-span-2 text-[12px] text-sub">사유<input name="reason" className="mt-1 w-full h-12 border border-line rounded-xl px-3" placeholder="선택 입력"/></label>
            <button className="col-span-2 h-12 rounded-xl bg-primary text-white font-bold">관리자에게 신청</button>
          </form>
          {leaves.length>0&&<div className="mt-5 border-t border-line pt-4"><p className="text-[13px] font-bold">최근 신청</p><div className="mt-2 divide-y divide-line">{leaves.map(l=><div key={l.id} className="py-2.5 flex justify-between gap-2 text-[12px]"><span>{l.start_date}{l.end_date!==l.start_date?`~${l.end_date.slice(5)}`:''} · {l.requested_minutes/60}시간</span><b className={l.status==='approved'?'text-success':l.status==='rejected'?'text-red-600':'text-amber-600'}>{l.status==='approved'?'승인':l.status==='rejected'?'반려':'대기'}</b></div>)}</div></div>}
        </section>
      </>}
    {message&&<p role="status" className="mt-4 rounded-xl bg-white border border-line p-3 text-[13px] font-bold">{message}</p>}
  </main>;
}

export default function WorkplacePage(){
  return <Suspense fallback={<main className="min-h-screen bg-bg p-8 text-center text-sub">직장 정보를 불러오고 있어요...</main>}><WorkplaceContent/></Suspense>;
}
