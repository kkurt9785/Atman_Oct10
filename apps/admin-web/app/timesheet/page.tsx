import Link from 'next/link';
import { Card, SectionTitle } from '@/components/ui';
import { getClinicStaff, getTodayAttendanceFailures } from '@/lib/db/clinic-workforce';
import { getStaff } from '@/lib/db/staff';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';

const STATUS:Record<string,{label:string;style:string}> = {
  scheduled:{label:'출근 예정',style:'bg-primary/10 text-primary'}, working:{label:'근무 중',style:'bg-success/15 text-success'},
  checkout_pending:{label:'조기퇴근 승인 대기',style:'bg-warn/15 text-warn'},
  completed:{label:'퇴근 완료',style:'bg-bg text-sub'}, late:{label:'지각',style:'bg-warn/15 text-warn'},
  absent:{label:'결근',style:'bg-red-50 text-red-600'}, leave:{label:'휴가',style:'bg-purple-50 text-purple-600'},
};
const fmt=(iso:string|null|undefined)=>iso?new Date(iso).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}):'—';
const AUTH:Record<string,string>={GPS:'GPS',GPS_QR:'GPS + QR',QR:'동적 QR',QR_FALLBACK:'QR 보완',ADMIN:'관리자 승인',qr:'기존 QR',button:'원터치'};
const FAIL:Record<string,string>={OUT_OF_RANGE:'병원 반경 밖',GPS_ERROR:'위치 확인 실패',GPS_ACCURACY_LOW:'GPS 정확도 낮음',QR_EXPIRED:'QR 만료',QR_INVALID:'QR 무효',HOSPITAL_MISMATCH:'병원 정보 불일치',TIME_NOT_ALLOWED:'인증 가능시간 아님',DUPLICATE_ATTENDANCE:'중복 요청',NOT_ASSIGNED:'배정 정보 없음',INVALID_STATE:'처리 순서 오류',ADMIN_REQUIRED:'관리자 승인 필요'};

export default async function TimesheetPage(){
  const [staff, matched,failures] = await Promise.all([getClinicStaff(),getStaff(),getTodayAttendanceFailures()]);
  const working=staff.filter((s)=>s.attendanceStatus==='working').length;
  const completed=staff.filter((s)=>s.attendanceStatus==='completed').length;
  const issues=staff.filter((s)=>['late','absent','checkout_pending'].includes(s.attendanceStatus)).length;
  const today=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short'});
  return <main className="px-4 pb-28">
    <div className="mt-3 px-1"><p className="text-label font-bold text-primary">하루 근태를 한눈에</p><h1 className="text-display font-extrabold">오늘 근태</h1><p className="text-label text-sub mt-1">{today} · 직접 등록 직원과 신규 인력을 함께 확인해요.</p></div>
    <div className="grid grid-cols-3 gap-2 mt-4">
      {[['근무 중',working,'text-success'],['퇴근',completed,'text-ink'],['확인 필요',issues,'text-red-600']].map(([l,v,c])=><Card key={String(l)} className="p-3"><p className="text-[11px] text-sub">{l}</p><p className={`text-title font-extrabold mt-1 ${c}`}>{v}명</p></Card>)}
    </div>
    <div className="grid grid-cols-3 gap-2 mt-3"><Link href="/staff" className="h-11 rounded-xl border border-line bg-white flex items-center justify-center text-label font-bold">직원 등록</Link><Link href="/attendance-qr" className="h-11 rounded-xl bg-primary text-white flex items-center justify-center text-label font-bold">직원 QR</Link><Link href="/leave" className="h-11 rounded-xl border border-line bg-white flex items-center justify-center text-label font-bold">휴가 관리</Link></div>

    <SectionTitle>기존 직원</SectionTitle>
    {staff.length===0?<Card className="py-9 text-center"><p className="font-bold">등록된 직원이 없어요</p><Link href="/staff" className="inline-block text-primary text-label font-bold mt-2">직원 등록하기 →</Link></Card>:
      <div className="space-y-3">{staff.map((s)=>{const state=STATUS[s.attendanceStatus]??STATUS.scheduled; return <Card key={s.id} className="p-4 shadow-card">
        <div className="flex justify-between gap-3"><div><p className="font-bold">{s.name}</p><p className="text-label text-sub">{s.department??'부서 미지정'} · {s.defaultStart.slice(0,5)}~{s.defaultEnd.slice(0,5)}</p></div><span className={`h-fit text-[11px] font-bold px-2.5 py-1 rounded-full ${state.style}`}>{state.label}</span></div>
        <div className="mt-3 rounded-xl bg-bg px-3 py-2 text-label text-sub"><div>출근 <b className="text-ink">{fmt(s.checkInAt)}</b><span className="mx-2">→</span>퇴근 <b className="text-ink">{fmt(s.checkOutAt)}</b></div>{(s.checkInMethod||s.checkOutMethod)&&<div className="mt-1 text-[11px]">인증 {AUTH[s.checkOutMethod??s.checkInMethod??'']??s.checkOutMethod??s.checkInMethod}{s.checkInDistanceM!=null?` · ${s.checkInDistanceM}m`:''}{s.adminApproved?' · 관리자 승인':''}</div>}{(s.lateMinutes>0||s.earlyLeaveMinutes>0)&&<div className="mt-1 text-[11px] text-warn">{s.lateMinutes>0?`지각 ${s.lateMinutes}분`:''}{s.earlyLeaveMinutes>0?` · 조퇴 ${s.earlyLeaveMinutes}분`:''}</div>}</div>
        {s.attendanceStatus==='checkout_pending'&&<div className="mt-3 rounded-xl border border-warn/30 bg-warn/5 p-3"><p className="text-[12px] font-bold text-warn">예정 시간 전 퇴근 요청 · {fmt(s.checkoutRequestedAt)}{s.workDate!==new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10)?' · 전날 야간근무':''}</p><div className="grid grid-cols-2 gap-2 mt-2"><WorkforceActionForm kind="early_checkout" values={{staff_id:s.id,work_date:s.workDate,decision:'rejected'}}><button className="w-full h-9 rounded-lg border border-line bg-white text-[12px] font-bold">반려</button></WorkforceActionForm><WorkforceActionForm kind="early_checkout" values={{staff_id:s.id,work_date:s.workDate,decision:'approved'}}><button className="w-full h-9 rounded-lg bg-primary text-white text-[12px] font-bold">퇴근 승인</button></WorkforceActionForm></div></div>}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <WorkforceActionForm kind="attendance" values={{staff_id:s.id,work_date:s.workDate,event:'check_in'}}><button disabled={Boolean(s.checkInAt)} className="w-full h-10 rounded-lg bg-primary text-white text-[12px] font-bold disabled:opacity-30">출근 처리</button></WorkforceActionForm>
          <WorkforceActionForm kind="attendance" values={{staff_id:s.id,work_date:s.workDate,event:'check_out'}}><button disabled={!s.checkInAt||Boolean(s.checkOutAt)} className="w-full h-10 rounded-lg bg-ink text-white text-[12px] font-bold disabled:opacity-30">퇴근 처리</button></WorkforceActionForm>
          <WorkforceActionForm kind="attendance" values={{staff_id:s.id,work_date:s.workDate,event:'absent'}}><button disabled={Boolean(s.checkInAt)} className="w-full h-10 rounded-lg border border-line text-[12px] font-bold disabled:opacity-30">결근 표시</button></WorkforceActionForm>
        </div>
      </Card>})}</div>}

    {matched.length>0&&<><SectionTitle>오늘 확정된 단기인력</SectionTitle><Card className="divide-y divide-line p-0">{matched.map((s)=><div key={s.shiftId} className="px-5 py-4"><div className="flex justify-between gap-3"><div><p className="font-bold">{s.name}</p><p className="text-label text-sub">단기·시프트 · {fmt(s.checkInAt)} → {fmt(s.checkOutAt)}</p>{(s.checkInMethod||s.checkOutMethod)&&<p className="mt-1 text-[11px] text-sub">인증 {AUTH[s.checkOutMethod??s.checkInMethod??'']??s.checkOutMethod??s.checkInMethod}{s.checkInDistanceM!=null?` · ${s.checkInDistanceM}m`:''}</p>}</div><span className="text-label font-bold text-primary">{s.todayStatus}</span></div>{s.applicationId&&<div className="mt-3 grid grid-cols-2 gap-2"><WorkforceActionForm kind="shift_attendance" values={{application_id:s.applicationId,event:'check_in'}}><button disabled={Boolean(s.checkInAt)} className="h-9 w-full rounded-lg bg-primary text-[12px] font-bold text-white disabled:opacity-30">출근 승인</button></WorkforceActionForm><WorkforceActionForm kind="shift_attendance" values={{application_id:s.applicationId,event:'check_out'}}><button disabled={!s.checkInAt||Boolean(s.checkOutAt)} className="h-9 w-full rounded-lg bg-ink text-[12px] font-bold text-white disabled:opacity-30">퇴근 승인</button></WorkforceActionForm></div>}</div>)}</Card></>}
    {failures.length>0&&<><SectionTitle>오늘 인증 실패</SectionTitle><Card className="divide-y divide-line p-0">{failures.map((row:any)=><div key={row.id} className="px-4 py-3"><div className="flex justify-between gap-2"><b className="text-[13px]">{row.target_type==='staff'?'직원':'단기인력'} · {row.action==='check_in'?'출근':'퇴근'}</b><span className="text-[11px] font-bold text-red-600">{FAIL[row.failure_reason]??row.failure_reason}</span></div><p className="mt-1 text-[11px] text-sub">{AUTH[row.authentication_method]??row.authentication_method}{row.distance_meters!=null?` · 거리 ${row.distance_meters}m`:''}{row.gps_accuracy_meters!=null?` · 정확도 ±${row.gps_accuracy_meters}m`:''} · {fmt(row.created_at)}</p></div>)}</Card></>}
    <p className="text-[11px] text-sub leading-5 mt-4 px-1">병원 관리자가 입력·승인한 운영 기록입니다. 법정 휴가와 임금의 최종 판단은 병원의 계약 및 취업규칙을 기준으로 확인해 주세요.</p>
  </main>;
}
