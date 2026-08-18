import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { getShop } from '@/lib/db/shop';
import { getStaff } from '@/lib/db/staff';
import { getPendingCount } from '@/lib/db/applications';
import { getOperationsSummary, getOperationsAlerts } from '@/lib/db/operations';
import { getClinicStaff } from '@/lib/db/clinic-workforce';
import { getAdminContext } from '@/lib/admin-auth';
import { OperationsFlow } from '@/components/OperationsFlow';

export default async function Home() {
  const [shop, staff, clinicStaff, pendingCount, ops, alerts, context] = await Promise.all([
    getShop(),
    getStaff(),
    getClinicStaff(),
    getPendingCount(),
    getOperationsSummary(),
    getOperationsAlerts(),
    getAdminContext(),
  ]);
  const canViewPayroll = context?.canViewPayroll ?? false;

  if (!shop) redirect('/setup/claim-facility');

  const isPharmacy = shop.facilityType === 'pharmacy';
  const noShowCount = alerts.filter((a) => a.kind === 'no_show').length;
  const attendanceReviewCount = clinicStaff.filter((row) => row.attendanceStatus === 'checkout_pending').length + noShowCount;
  const shiftStaff=staff.filter(shift=>!clinicStaff.some(managed=>managed.workerId===shift.id));
  const todayCount=clinicStaff.length+shiftStaff.length;
  const workingCount=clinicStaff.filter(s=>['working','late','checkout_pending'].includes(s.attendanceStatus??'')).length
    +shiftStaff.filter(s=>s.todayStatus==='근무중').length;

  return (
    <main className="px-4">
      <div className="px-1 mt-2 mb-4">
        <p className="text-body text-sub">{shop.name}</p>
        <h1 className="text-display font-extrabold text-ink mt-1">{isPharmacy?'약국장님':'원장님'}, 안녕하세요 👋</h1>
      </div>

      {/* 첫 화면은 숫자보다 오늘 상황과 다음 행동을 먼저 보여준다. */}
      <Card className="shadow-sm">
        <p className="text-label font-bold text-primary">오늘 근무</p>
        <div className="mt-1 flex items-end justify-between gap-4">
          <div><p className="text-[28px] leading-tight font-extrabold text-ink">{todayCount}명 예정</p><p className="mt-1 text-body text-sub">지금 {workingCount}명이 근무 중이에요</p></div>
          <Link href="/timesheet" className="text-label font-bold text-primary whitespace-nowrap">현황 보기 →</Link>
        </div>
      </Card>

      <section className="mt-4">
        <div className="mb-3 flex items-end justify-between px-1"><div><p className="text-[11px] font-bold text-primary">오늘 처리할 일</p><h2 className="mt-0.5 text-title font-extrabold text-ink">확인이 필요한 업무</h2></div><Link href="/more" className="text-[12px] font-bold text-sub">전체 관리 →</Link></div>
        <Card className="divide-y divide-line p-0 overflow-hidden">
          {[
            {label:'새 지원자',description:'지원자를 확인하고 근무를 확정해요',count:pendingCount,href:'/applications'},
            {label:'출퇴근 확인',description:'조기 퇴근·미출근 기록을 확인해요',count:attendanceReviewCount,href:'/timesheet'},
            {label:'지급 대기',description:canViewPayroll?'근무시간을 확인하고 지급을 완료해요':'급여 담당자에게 확인을 요청해요',count:canViewPayroll?ops.pendingWageCount:0,href:canViewPayroll?'/payroll':'/timesheet'},
          ].map((item)=><Link key={item.label} href={item.href} className="flex min-h-[72px] items-center justify-between gap-3 px-5 py-3 active:bg-bg">
            <div><p className="text-body font-extrabold text-ink">{item.label}</p><p className="mt-0.5 text-[12px] text-sub">{item.description}</p></div>
            <span className={`flex min-w-[58px] items-center justify-end gap-1 text-[17px] font-extrabold ${item.count>0?'text-primary':'text-sub'}`}>{item.count}건 <span className="text-sub">›</span></span>
          </Link>)}
        </Card>
        {pendingCount+attendanceReviewCount+(canViewPayroll?ops.pendingWageCount:0)===0&&<p className="mt-2 px-1 text-[12px] font-medium text-success">오늘 바로 처리할 업무를 모두 마쳤어요.</p>}
      </section>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link href="/shifts/new" className="rounded-2xl bg-primary px-5 py-5 text-white shadow-btn active:opacity-85"><span className="text-[20px]">＋</span><p className="mt-2 text-[17px] font-extrabold">근무자 모집</p><p className="mt-1 text-[12px] text-white/80">날짜와 시간만 정하면 돼요</p></Link>
        <Link href="/timesheet" className="rounded-2xl bg-white px-5 py-5 active:bg-bg"><span className="text-[20px]">◷</span><p className="mt-2 text-[17px] font-extrabold text-ink">오늘 근무 보기</p><p className="mt-1 text-[12px] text-sub">출퇴근과 확인 요청을 봐요</p></Link>
      </div>
      <div className="mt-3"><OperationsFlow compact/></div>
      {isPharmacy&&<Link href="/workforce" className="mt-3 flex items-center justify-between rounded-xl bg-primary/5 px-4 py-3 text-label font-bold text-primary"><span>함께 일한 약사 다시 부르기</span><span>→</span></Link>}

      {/* ⑥ SaaS 안내 — 최하단 한 줄 링크로 축소 */}
      <Link
        href="/membership"
        className="mt-6 mb-2 flex items-center justify-between px-4 py-3 rounded-xl bg-bg active:opacity-80"
      >
        <span className="text-label text-sub">
          중개 수수료 <b className="text-ink">0원</b> — 잇닿은 월 이용료만 받아요
        </span>
        <span className="text-label font-bold text-primary flex-shrink-0 ml-2">요금·청구 →</span>
      </Link>
    </main>
  );
}
