import Link from 'next/link';
import { Card, SectionTitle } from '@/components/ui';
import { getAdminContext } from '@/lib/admin-auth';
import { getStaff } from '@/lib/db/staff';
import { getClinicStaff } from '@/lib/db/clinic-workforce';
import { getPendingWorkers } from '@/lib/db/workers';
import { addClinicStaffAction, convertMatchedWorkerToStaffAction } from '@/lib/actions/clinic-workforce';
import { WorkerApprovalCard } from './WorkerApprovalCard';

const ROLE: Record<string,string> = { rn:'간호사', na:'간호조무사', coordinator:'코디네이터', admin:'행정', other:'기타' };
const TYPE: Record<string,string> = { regular:'상시 직원', fixed_term:'기간제', temporary:'임시 계약', daily:'단기 근무' };
const SOURCE: Record<string,string> = { direct:'직접 등록', atman:'잇닿 채용', imported:'가져오기' };

export default async function StaffPage() {
  const context = await getAdminContext();
  const canReviewWorkers = context?.accessRole === 'super';
  const [clinicStaff, shiftStaff, pending] = await Promise.all([
    getClinicStaff(), getStaff(), canReviewWorkers ? getPendingWorkers() : Promise.resolve([]),
  ]);
  const contractCount = clinicStaff.filter((s)=>['fixed_term','temporary','daily'].includes(s.engagementType)).length;

  return <main className="px-4 pb-28">
    <div className="mt-3 mb-4 px-1">
      <p className="text-label font-bold text-primary">기존 직원 + 신규 채용인력</p>
      <h1 className="text-display font-extrabold text-ink">직원 관리</h1>
      <p className="text-label text-sub mt-1">직원 10명 이하 병원도 설정 없이 바로 시작할 수 있어요.</p>
    </div>

    <div className="grid grid-cols-3 gap-2">
      {[['관리 직원',`${clinicStaff.length}명`],['계약·단기',`${contractCount}명`],['오늘 매칭',`${shiftStaff.length}명`]].map(([label,value])=>
        <Card key={label} className="p-3 shadow-sm"><p className="text-[11px] text-sub">{label}</p><p className="text-title font-extrabold mt-1">{value}</p></Card>
      )}
    </div>

    <div className="grid grid-cols-2 gap-2 mt-3">
      <Link href="/timesheet" className="min-h-tap rounded-xl bg-primary text-white flex items-center justify-center text-body font-bold">오늘 근태 보기</Link>
      <Link href="/leave" className="min-h-tap rounded-xl bg-white border border-line flex items-center justify-center text-body font-bold">휴가 관리</Link>
    </div>

    <details className="mt-5 bg-white rounded-2xl shadow-card group">
      <summary className="list-none cursor-pointer px-5 py-4 flex items-center justify-between">
        <span className="font-bold text-body">＋ 기존 직원 직접 등록</span><span className="text-sub group-open:rotate-180">⌄</span>
      </summary>
      <form action={addClinicStaffAction} className="px-5 pb-5 grid grid-cols-2 gap-3">
        <label className="col-span-2 text-label text-sub">이름<input name="name" required maxLength={80} className="mt-1 w-full h-12 rounded-xl border border-line px-3 text-body text-ink" placeholder="예: 김지영"/></label>
        <label className="text-label text-sub">직종<select name="role" className="mt-1 w-full h-12 rounded-xl border border-line px-3 bg-white"><option value="rn">간호사</option><option value="na">간호조무사</option><option value="coordinator">코디네이터</option><option value="admin">행정</option><option value="other">기타</option></select></label>
        <label className="text-label text-sub">근무 형태<select name="engagement_type" className="mt-1 w-full h-12 rounded-xl border border-line px-3 bg-white"><option value="regular">상시 직원</option><option value="fixed_term">기간제 계약</option><option value="temporary">임시 계약</option><option value="daily">단기 근무</option></select></label>
        <label className="text-label text-sub">부서<input name="department" className="mt-1 w-full h-12 rounded-xl border border-line px-3" placeholder="예: 외래"/></label>
        <label className="text-label text-sub">연락처<input name="phone" inputMode="tel" className="mt-1 w-full h-12 rounded-xl border border-line px-3" placeholder="선택"/></label>
        <label className="text-label text-sub">계약 시작<input name="contract_start" type="date" className="mt-1 w-full h-12 rounded-xl border border-line px-2"/></label>
        <label className="text-label text-sub">계약 종료<input name="contract_end" type="date" className="mt-1 w-full h-12 rounded-xl border border-line px-2"/></label>
        <label className="text-label text-sub">기본 출근<input name="default_start_time" type="time" defaultValue="09:00" className="mt-1 w-full h-12 rounded-xl border border-line px-2"/></label>
        <label className="text-label text-sub">기본 퇴근<input name="default_end_time" type="time" defaultValue="18:00" className="mt-1 w-full h-12 rounded-xl border border-line px-2"/></label>
        <input type="hidden" name="default_break_minutes" value="60"/>
        <button className="col-span-2 h-12 rounded-xl bg-ink text-white font-bold">직원 등록</button>
      </form>
    </details>

    <SectionTitle>관리 중인 직원</SectionTitle>
    {clinicStaff.length===0 ? <Card className="py-9 text-center"><p className="font-bold">아직 직접 등록한 직원이 없어요</p><p className="text-label text-sub mt-1">위 버튼에서 기존 직원부터 등록해 보세요.</p></Card> :
      <Card className="divide-y divide-line p-0">{clinicStaff.map((s)=><div key={s.id} className="px-5 py-4 flex items-start justify-between gap-3">
        <div><div className="flex gap-2 items-center"><p className="font-bold">{s.name}</p><span className="text-[10px] rounded bg-bg px-1.5 py-0.5 text-sub">{SOURCE[s.source]}</span></div><p className="text-label text-sub mt-1">{ROLE[s.role]??s.role} · {s.department??'부서 미지정'}</p><p className="text-[12px] text-sub mt-0.5">{TYPE[s.engagementType]}{s.contractEnd?` · ${s.contractEnd}까지`:''}</p></div>
        <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-success/10 text-success">{s.status==='active'?'재직':'휴가'}</span>
      </div>)}</Card>}

    {shiftStaff.length>0&&<><SectionTitle>오늘 잇닿으로 확정된 인력</SectionTitle><Card className="divide-y divide-line p-0">{shiftStaff.map((s)=>{const managed=clinicStaff.some((staff)=>staff.id===s.id); return <div key={s.id} className="px-5 py-4"><div className="flex justify-between"><div><p className="font-bold">{s.name}</p><p className="text-label text-sub">{s.job}</p></div><span className="text-label font-bold text-primary">{s.todayStatus}</span></div>{managed?<p className="text-[12px] text-success font-bold mt-2">직원 관리에 연결됨</p>:<form action={convertMatchedWorkerToStaffAction} className="grid grid-cols-3 gap-2 mt-3"><input type="hidden" name="worker_id" value={s.id}/><input name="default_start_time" type="time" defaultValue="09:00" className="h-10 rounded-lg border border-line px-2 text-[12px]"/><input name="default_end_time" type="time" defaultValue="18:00" className="h-10 rounded-lg border border-line px-2 text-[12px]"/><button className="h-10 rounded-lg bg-primary/10 text-primary text-[12px] font-bold">직원 전환</button></form>}</div>})}</Card></>}

    {canReviewWorkers&&<><SectionTitle>플랫폼 면허 심사</SectionTitle>{pending.length===0?<Card className="py-7 text-center text-label text-sub">승인 대기 워커가 없어요.</Card>:<Card className="divide-y divide-line p-0">{pending.map((w)=><WorkerApprovalCard key={w.id} worker={w}/>)}</Card>}</>}
  </main>;
}
