import Link from 'next/link';
import { Card, SectionTitle } from '@/components/ui';
import { getClinicStaff } from '@/lib/db/clinic-workforce';
import { getStaff } from '@/lib/db/staff';
import { decideEarlyCheckoutAction, recordStaffAttendanceAction } from '@/lib/actions/clinic-workforce';

const STATUS:Record<string,{label:string;style:string}> = {
  scheduled:{label:'출근 예정',style:'bg-primary/10 text-primary'}, working:{label:'근무 중',style:'bg-success/15 text-success'},
  checkout_pending:{label:'조기퇴근 승인 대기',style:'bg-warn/15 text-warn'},
  completed:{label:'퇴근 완료',style:'bg-bg text-sub'}, late:{label:'지각',style:'bg-warn/15 text-warn'},
  absent:{label:'결근',style:'bg-red-50 text-red-600'}, leave:{label:'휴가',style:'bg-purple-50 text-purple-600'},
};
const fmt=(iso:string|null|undefined)=>iso?new Date(iso).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}):'—';

export default async function TimesheetPage(){
  const [staff, matched] = await Promise.all([getClinicStaff(),getStaff()]);
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
        <div className="mt-3 rounded-xl bg-bg px-3 py-2 text-label text-sub">출근 <b className="text-ink">{fmt(s.checkInAt)}</b><span className="mx-2">→</span>퇴근 <b className="text-ink">{fmt(s.checkOutAt)}</b></div>
        {s.attendanceStatus==='checkout_pending'&&<div className="mt-3 rounded-xl border border-warn/30 bg-warn/5 p-3"><p className="text-[12px] font-bold text-warn">예정 시간 전 퇴근 요청 · {fmt(s.checkoutRequestedAt)}</p><div className="grid grid-cols-2 gap-2 mt-2"><form action={decideEarlyCheckoutAction}><input type="hidden" name="staff_id" value={s.id}/><input type="hidden" name="decision" value="rejected"/><button className="w-full h-9 rounded-lg border border-line bg-white text-[12px] font-bold">반려</button></form><form action={decideEarlyCheckoutAction}><input type="hidden" name="staff_id" value={s.id}/><input type="hidden" name="decision" value="approved"/><button className="w-full h-9 rounded-lg bg-primary text-white text-[12px] font-bold">퇴근 승인</button></form></div></div>}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <form action={recordStaffAttendanceAction}><input type="hidden" name="staff_id" value={s.id}/><input type="hidden" name="event" value="check_in"/><button disabled={Boolean(s.checkInAt)} className="w-full h-10 rounded-lg bg-primary text-white text-[12px] font-bold disabled:opacity-30">출근 처리</button></form>
          <form action={recordStaffAttendanceAction}><input type="hidden" name="staff_id" value={s.id}/><input type="hidden" name="event" value="check_out"/><button disabled={!s.checkInAt||Boolean(s.checkOutAt)} className="w-full h-10 rounded-lg bg-ink text-white text-[12px] font-bold disabled:opacity-30">퇴근 처리</button></form>
          <form action={recordStaffAttendanceAction}><input type="hidden" name="staff_id" value={s.id}/><input type="hidden" name="event" value="absent"/><button className="w-full h-10 rounded-lg border border-line text-[12px] font-bold">결근 표시</button></form>
        </div>
      </Card>})}</div>}

    {matched.length>0&&<><SectionTitle>오늘 확정된 단기인력</SectionTitle><Card className="divide-y divide-line p-0">{matched.map((s)=><div key={s.id} className="px-5 py-4 flex justify-between"><div><p className="font-bold">{s.name}</p><p className="text-label text-sub">잇닿 신규인력 · {fmt(s.checkInAt)} → {fmt(s.checkOutAt)}</p></div><span className="text-label font-bold text-primary">{s.todayStatus}</span></div>)}</Card></>}
    <p className="text-[11px] text-sub leading-5 mt-4 px-1">병원 관리자가 입력·승인한 운영 기록입니다. 법정 휴가와 임금의 최종 판단은 병원의 계약 및 취업규칙을 기준으로 확인해 주세요.</p>
  </main>;
}
