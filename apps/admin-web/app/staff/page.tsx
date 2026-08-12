import Link from 'next/link';
import { Card, SectionTitle } from '@/components/ui';
import { getAdminContext } from '@/lib/admin-auth';
import { getStaff } from '@/lib/db/staff';
import { getClinicStaff } from '@/lib/db/clinic-workforce';
import { getPendingWorkers } from '@/lib/db/workers';
import { WorkerApprovalCard } from './WorkerApprovalCard';
import { WorkforceActionForm } from '@/components/WorkforceActionForm';
import { CopyInviteButton } from './CopyInviteButton';
import { StaffRegistrationForm } from './StaffRegistrationForm';
import { getShop } from '@/lib/db/shop';
import { facilityTypeLabel } from '@/lib/facility-label';

const ROLE: Record<string,string> = { rn:'간호사', na:'간호조무사', pharmacist:'약사', pharmacy_staff:'약국 전산·사무직', coordinator:'코디네이터', admin:'행정', other:'기타' };
const TYPE: Record<string,string> = { regular:'상시 직원', fixed_term:'기간제', temporary:'임시 계약', daily:'단기 근무' };
const SOURCE: Record<string,string> = { direct:'직접 등록', atman:'잇닿 채용', imported:'가져오기' };
const PAY:Record<string,string>={monthly:'월급',hourly:'시급',daily:'일급'};

type StaffView='all'|'regular'|'contract'|'shift';

export default async function StaffPage({searchParams}:{searchParams:Promise<{view?:string}>}) {
  const requested=(await searchParams).view;
  const view:StaffView=['regular','contract','shift'].includes(requested??'')?requested as StaffView:'all';
  const context = await getAdminContext();
  const canReviewWorkers = context?.accessRole === 'super';
  const [clinicStaff, shiftStaff, pending,shop] = await Promise.all([
    getClinicStaff(), getStaff(), canReviewWorkers ? getPendingWorkers() : Promise.resolve([]),getShop(),
  ]);
  const facilityWord=facilityTypeLabel(shop?.facilityType);
  const contractCount = clinicStaff.filter((s)=>['fixed_term','temporary','daily'].includes(s.engagementType)).length;
  const regularCount=clinicStaff.filter((s)=>s.engagementType==='regular').length;
  const visibleStaff=view==='regular'?clinicStaff.filter((s)=>s.engagementType==='regular')
    :view==='contract'?clinicStaff.filter((s)=>['fixed_term','temporary','daily'].includes(s.engagementType))
    :view==='shift'?[]:clinicStaff;
  const workerOrigin=process.env.NEXT_PUBLIC_WORKER_WEB_URL
    ?? (process.env.NODE_ENV==='production'?'https://itdot.co.kr':'http://localhost:3003');

  return <main className="px-4 pb-28">
    <div className="mt-3 mb-4 px-1">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-[21px] text-ink shadow-sm active:bg-bg" aria-label="홈으로 돌아가기">←</Link>
        <div><p className="text-label font-bold text-primary">기존 직원 + 신규 채용인력</p><h1 className="text-display font-extrabold text-ink">직원 관리</h1></div>
      </div>
      <p className="text-label text-sub mt-1">직원 10명 이하 {facilityWord}도 설정 없이 바로 시작할 수 있어요.</p>
    </div>

    <div className="grid grid-cols-3 gap-2">
      {[['관리 직원',`${clinicStaff.length}명`],['계약·단기',`${contractCount}명`],['오늘 확정 인력',`${shiftStaff.length}명`]].map(([label,value])=>
        <Card key={label} className="p-3 shadow-sm"><p className="text-[11px] text-sub">{label}</p><p className="text-title font-extrabold mt-1">{value}</p></Card>
      )}
    </div>

    <nav aria-label="직원 유형" className="mt-3 grid grid-cols-4 gap-1 rounded-2xl bg-white p-1.5 shadow-sm">
      {([['all','전체',clinicStaff.length+shiftStaff.length],['regular','상시',regularCount],['contract','계약·임시',contractCount],['shift','오늘 단기',shiftStaff.length]] as const).map(([key,label,count])=><Link key={key} href={`/staff?view=${key}`} aria-current={view===key?'page':undefined} className={`flex min-h-11 flex-col items-center justify-center rounded-xl text-[11px] font-bold ${view===key?'bg-primary text-white':'text-sub'}`}><span>{label}</span><span className={`mt-0.5 text-[10px] ${view===key?'text-white/70':'text-tertiary'}`}>{count}명</span></Link>)}
    </nav>

    <div className="grid grid-cols-2 gap-2 mt-3">
      <Link href="/timesheet" className="min-h-tap rounded-xl bg-primary text-white flex items-center justify-center text-body font-bold">오늘 근태 보기</Link>
      <Link href="/leave" className="min-h-tap rounded-xl bg-white border border-line flex items-center justify-center text-body font-bold">휴가 관리</Link>
    </div>

    <details className="mt-5 bg-white rounded-2xl shadow-card group">
      <summary className="list-none cursor-pointer px-5 py-4 flex items-center justify-between">
        <span className="font-bold text-body">＋ 기존 직원 직접 등록</span><span className="text-sub group-open:rotate-180">⌄</span>
      </summary>
      <StaffRegistrationForm facilityType={shop?.facilityType}/>
    </details>

    {view!=='shift'&&<><SectionTitle>{view==='regular'?'상시 직원':view==='contract'?'계약·임시 직원':'관리 중인 직원'}</SectionTitle>
    {visibleStaff.length===0 ? <Card className="py-9 text-center"><p className="font-bold">해당 유형의 직원이 없어요</p><p className="text-label text-sub mt-1">위 등록 메뉴에서 직원을 추가할 수 있어요.</p></Card> :
      <Card className="divide-y divide-line p-0">{visibleStaff.map((s)=><div key={s.id} className="px-5 py-4">
        <div className="flex items-start justify-between gap-3"><div><div className="flex gap-2 items-center"><p className="font-bold">{s.name}</p><span className="text-[10px] rounded bg-bg px-1.5 py-0.5 text-sub">{SOURCE[s.source]}</span></div><p className="text-label text-sub mt-1">{ROLE[s.role]??s.role} · {s.department??'부서 미지정'}</p><p className="text-[12px] text-sub mt-0.5">{TYPE[s.engagementType]}{s.contractEnd?` · ${s.contractEnd}까지`:''}</p></div>
        <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${s.status==='active'?'bg-success/10 text-success':s.status==='leave'?'bg-amber-100 text-amber-700':'bg-bg text-sub'}`}>{s.status==='active'?'재직':s.status==='leave'?'휴가':'종료'}</span></div>
        <div className="mt-2">{s.workerId?<p className="text-[12px] font-bold text-success">✓ 직원 계정 연결됨</p>:s.phone?.startsWith('DEMO-')?<p className="text-[12px] text-sub">데모 직원</p>:s.inviteToken?<div className="flex justify-between items-center"><p className="text-[12px] text-warn">초대 대기 · 7일 이내</p><CopyInviteButton url={`${workerOrigin}/workplace/join?token=${s.inviteToken}`}/></div>:s.phone?<WorkforceActionForm kind="create_invite" values={{staff_id:s.id}} successMessage="초대 링크를 만들었어요."><button className="text-[12px] font-bold text-primary">직원 초대 링크 만들기</button></WorkforceActionForm>:<p className="text-[12px] text-sub">연락처를 등록해야 계정을 연결할 수 있어요.</p>}</div>
        <details className="mt-3 rounded-xl bg-bg group"><summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3 text-[12px] font-bold"><span>{s.payBasis&&s.payRate?`${PAY[s.payBasis]} ${s.payRate.toLocaleString('ko-KR')}원`:'급여 기준 설정 필요'}</span><span className="text-sub">시급 확인 ›</span></summary><WorkforceActionForm kind="set_staff_pay" values={{staff_id:s.id}} className="grid grid-cols-2 gap-2 px-3 pb-3" successMessage="급여 기준을 저장했어요."><select name="pay_basis" defaultValue={s.payBasis??'hourly'} className="h-11 rounded-xl border border-line bg-white px-3 text-[12px]"><option value="hourly">시급</option><option value="monthly">월급</option><option value="daily">일급</option></select><input name="pay_rate" type="number" min="1" step="100" required defaultValue={s.payRate??undefined} placeholder="세전 시급" className="h-11 rounded-xl border border-line bg-white px-3 text-[12px]"/>{s.workerId?<div className="col-span-2 rounded-xl border border-success/20 bg-success/5 px-3 py-3"><p className="text-[12px] font-bold text-success">✓ 워커 등록 지급계좌 확인됨</p><p className="mt-1 text-[11px] text-sub">{s.bankName&&s.accountLast4?`${s.bankName} · ****${s.accountLast4}`:'계좌 정보 동기화 중'} · 변경은 워커 본인만 가능</p></div>:<><input name="bank_name" maxLength={40} defaultValue={s.bankName??''} placeholder="지급 은행" className="h-11 rounded-xl border border-line bg-white px-3 text-[12px]"/><input name="account_last4" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} defaultValue={s.accountLast4??''} placeholder="계좌 끝 4자리" className="h-11 rounded-xl border border-line bg-white px-3 text-[12px]"/></>}<p className="col-span-2 text-[11px] leading-4 text-sub">인정 근무시간은 근태 기록에서 자동 집계되며 급여 지급관리에서 최종 확인해요.</p><button className="col-span-2 h-10 rounded-xl bg-ink text-[12px] font-bold text-white">시급 저장</button></WorkforceActionForm></details>
      </div>)}</Card>}</>}

    {(view==='all'||view==='shift')&&<><SectionTitle>오늘 확정된 단기근무</SectionTitle>{shiftStaff.length===0?<Card className="py-8 text-center text-label text-sub">오늘 확정된 단기근무가 없어요.</Card>:<Card className="divide-y divide-line p-0">{shiftStaff.map((s)=>{const managed=clinicStaff.some((staff)=>staff.workerId===s.id); return <div key={s.id} className="px-5 py-4"><div className="flex justify-between"><div><p className="font-bold">{s.name}</p><p className="text-label text-sub">{s.job}</p></div><span className="text-label font-bold text-primary">{s.todayStatus}</span></div>{managed?<p className="text-[12px] text-success font-bold mt-2">직원 관리에 연결됨</p>:<WorkforceActionForm kind="convert_worker" values={{worker_id:s.id}} className="grid grid-cols-3 gap-2 mt-3" successMessage="직원 관리에 연결했어요."><input name="default_start_time" type="time" defaultValue="09:00" className="h-10 rounded-lg border border-line px-2 text-[12px]"/><input name="default_end_time" type="time" defaultValue="18:00" className="h-10 rounded-lg border border-line px-2 text-[12px]"/><button className="h-10 rounded-lg bg-primary/10 text-primary text-[12px] font-bold">직원 전환</button></WorkforceActionForm>}</div>})}</Card>}</>}

    {canReviewWorkers&&<><SectionTitle>플랫폼 면허 심사</SectionTitle>{pending.length===0?<Card className="py-7 text-center text-label text-sub">승인 대기 워커가 없어요.</Card>:<Card className="divide-y divide-line p-0">{pending.map((w)=><WorkerApprovalCard key={w.id} worker={w}/>)}</Card>}</>}
  </main>;
}
