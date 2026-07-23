import { Card } from '@/components/ui';
import { getClinicLeaveRequests, getClinicStaff } from '@/lib/db/clinic-workforce';
import { addStaffLeaveAction, decideStaffLeaveAction, setStaffLeaveBalanceAction } from '@/lib/actions/clinic-workforce';

const TYPE:Record<string,string>={annual:'연차',half_day:'반차',quarter_day:'반반차',hourly:'시간차',sick:'병가',other:'기타'};
const STATUS:Record<string,{label:string;style:string}>={pending:{label:'승인 대기',style:'text-warn bg-warn/10'},approved:{label:'승인',style:'text-success bg-success/10'},rejected:{label:'반려',style:'text-red-600 bg-red-50'},cancelled:{label:'취소',style:'text-sub bg-bg'}};
const days=(minutes:number)=>(minutes/480).toLocaleString('ko-KR',{maximumFractionDigits:1});

export default async function LeavePage(){
  const [staff,requests]=await Promise.all([getClinicStaff(),getClinicLeaveRequests()]);
  const total=staff.reduce((sum,s)=>sum+s.leaveMinutes,0);
  return <main className="px-4 pb-28">
    <div className="mt-3 px-1"><p className="text-label font-bold text-primary">직원 신청 → 관리자 승인</p><h1 className="text-display font-extrabold">휴가</h1><p className="text-label text-sub mt-1">직원이 신청하면 확인 후 승인하고, 승인 시에만 잔여시간이 차감돼요.</p></div>
    <Card className="mt-4 bg-primary text-white"><p className="text-label text-white/70">전체 직원 잔여 휴가</p><p className="text-money font-extrabold mt-1">{days(total)}일</p><p className="text-[11px] text-white/70 mt-2">병원이 입력한 부여시간 기준</p></Card>
    <details className="mt-3 bg-primary/5 border border-primary/15 rounded-2xl group">
      <summary className="list-none px-5 py-4 flex justify-between cursor-pointer"><b className="text-primary">잔여 휴가 설정</b><span className="text-sub">⌄</span></summary>
      <form action={setStaffLeaveBalanceAction} className="px-5 pb-5 grid grid-cols-2 gap-3">
        <label className="col-span-2 text-label text-sub">직원<select name="staff_id" required className="mt-1 w-full h-12 rounded-xl border border-line px-3 bg-white"><option value="">선택해 주세요</option>{staff.map((s)=><option key={s.id} value={s.id}>{s.name} · 잔여 {days(s.leaveMinutes)}일</option>)}</select></label>
        <label className="text-label text-sub">연도<input name="leave_year" type="number" defaultValue={new Date().getFullYear()} className="mt-1 w-full h-12 rounded-xl border border-line px-3 bg-white"/></label>
        <label className="text-label text-sub">총 부여일수<input name="granted_days" type="number" min="0" max="365" step="0.5" required className="mt-1 w-full h-12 rounded-xl border border-line px-3 bg-white" placeholder="예: 15"/></label>
        <button className="col-span-2 h-12 rounded-xl bg-primary text-white font-bold">저장</button>
      </form>
    </details>
    <details className="mt-4 bg-white rounded-2xl shadow-card group">
      <summary className="list-none px-5 py-4 flex justify-between cursor-pointer"><b>＋ 휴가 바로 등록</b><span className="text-sub">⌄</span></summary>
      <form action={addStaffLeaveAction} className="px-5 pb-5 grid grid-cols-2 gap-3">
        <label className="col-span-2 text-label text-sub">직원<select name="staff_id" required className="mt-1 w-full h-12 rounded-xl border border-line px-3 bg-white"><option value="">선택해 주세요</option>{staff.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="text-label text-sub">휴가 종류<select name="leave_type" className="mt-1 w-full h-12 rounded-xl border border-line px-3 bg-white"><option value="annual">연차 · 종일</option><option value="half_day">반차 · 4시간</option><option value="quarter_day">반반차 · 2시간</option><option value="hourly">시간차</option><option value="sick">병가</option><option value="other">기타</option></select></label>
        <label className="text-label text-sub">시간차 사용시간<select name="hourly_minutes" className="mt-1 w-full h-12 rounded-xl border border-line px-3 bg-white"><option value="60">1시간</option><option value="120">2시간</option><option value="180">3시간</option><option value="240">4시간</option><option value="300">5시간</option><option value="360">6시간</option><option value="420">7시간</option></select><span className="block text-[10px] mt-1">시간차 선택 시에만 적용</span></label>
        <label className="text-label text-sub">시작일<input name="start_date" type="date" required className="mt-1 w-full h-12 rounded-xl border border-line px-2"/></label>
        <label className="text-label text-sub">종료일<input name="end_date" type="date" className="mt-1 w-full h-12 rounded-xl border border-line px-2"/></label>
        <label className="col-span-2 text-label text-sub">메모<input name="reason" className="mt-1 w-full h-12 rounded-xl border border-line px-3" placeholder="선택"/></label>
        <button disabled={staff.length===0} className="col-span-2 h-12 rounded-xl bg-ink text-white font-bold disabled:opacity-30">승인 휴가로 등록</button>
      </form>
    </details>
    <h2 className="text-title font-bold mt-7 mb-3 px-1">최근 휴가</h2>
    {requests.length===0?<Card className="py-9 text-center text-label text-sub">등록된 휴가가 없어요.</Card>:<Card className="divide-y divide-line p-0">{requests.map((r:any)=>{const person=Array.isArray(r.facility_staff)?r.facility_staff[0]:r.facility_staff; const state=STATUS[r.status]??STATUS.pending; return <div key={r.id} className="px-5 py-4">
      <div className="flex justify-between gap-3"><div><p className="font-bold">{person?.name??'직원'}</p><p className="text-label text-sub mt-1">{r.start_date}{r.end_date!==r.start_date?` ~ ${r.end_date}`:''} · {TYPE[r.leave_type]??'휴가'} · {r.requested_minutes/60}시간</p>{r.reason&&<p className="text-[12px] text-sub mt-1">{r.reason}</p>}</div><span className={`text-[11px] font-bold rounded-full h-fit px-2 py-1 ${state.style}`}>{state.label}</span></div>
      {r.status==='pending'&&<div className="grid grid-cols-2 gap-2 mt-3">
        <form action={decideStaffLeaveAction}><input type="hidden" name="request_id" value={r.id}/><input type="hidden" name="decision" value="rejected"/><button className="w-full h-10 rounded-xl border border-line text-label font-bold">반려</button></form>
        <form action={decideStaffLeaveAction}><input type="hidden" name="request_id" value={r.id}/><input type="hidden" name="decision" value="approved"/><button className="w-full h-10 rounded-xl bg-primary text-white text-label font-bold">승인</button></form>
      </div>}
    </div>})}</Card>}
  </main>;
}
