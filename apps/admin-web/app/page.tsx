import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { getShop } from '@/lib/db/shop';
import { isPlatformAdminUser } from '@/lib/platform-admin';
import { getStaff } from '@/lib/db/staff';
import { getPendingCount } from '@/lib/db/applications';
import { getOperationsSummary, getOperationsAlerts } from '@/lib/db/operations';
import { getClinicStaff, getTodayAttendanceFailures } from '@/lib/db/clinic-workforce';
import { getAdminContext } from '@/lib/admin-auth';
import { OperationsFlow } from '@/components/OperationsFlow';
import { QrCanvas } from '@/components/QrCanvas';
import { AdminInstallButton } from '@/components/AdminInstallButton';
import { GigOperationsBoard } from '@/components/GigOperationsBoard';
import { getGigOperationsBoard } from '@/lib/db/gig-operations';
import { listGigProjects } from '@/lib/db/gig-projects';
import { getActiveCoverRequests } from '@/lib/db/cover';

export default async function Home({ searchParams }: { searchParams: Promise<{ brn?: string }> }) {
  const brnFailed = (await searchParams).brn === 'failed';
  const [shop, staff, clinicStaff, attendanceFailures, pendingCount, ops, alerts, context, covers] = await Promise.all([
    getShop(),
    getStaff(),
    getClinicStaff(),
    getTodayAttendanceFailures(),
    getPendingCount(),
    getOperationsSummary(),
    getOperationsAlerts(),
    getAdminContext(),
    // 홈은 대타 조회가 실패해도 떠야 한다 — 실패하면 이 줄만 0건으로 둔다
    getActiveCoverRequests().catch(() => []),
  ]);
  if (!context) redirect('/login');
  const canViewPayroll = context?.canViewPayroll ?? false;

  // 잇닿 운영 계정은 사업장이 없어도 승인 화면으로 바로 간다. 일반 관리자는 사업장 연결부터.
  if (!shop) redirect(isPlatformAdminUser(context?.user) ? '/ops/facilities' : '/setup/claim-facility');

  const isPharmacy = shop.facilityType === 'pharmacy';
  const isGigworker = shop.mode === 'gig';
  const noShowCount = alerts.filter((a) => a.kind === 'no_show').length;
  const coverToApprove = covers.filter((cover) => cover.status === 'claimed').length;
  const attendanceReviewCount = clinicStaff.filter((row) => row.attendanceStatus === 'checkout_pending').length + noShowCount + attendanceFailures.length;
  const shiftStaff=staff.filter(shift=>!clinicStaff.some(managed=>managed.workerId===shift.id));
  const todayCount=clinicStaff.length+shiftStaff.length;
  const activeStaffCount = clinicStaff.filter((row) => row.status !== 'ended').length;
  const targetStaffCount = shop.employeeCount ?? 0;
  const registeredShortage = targetStaffCount > 0 ? Math.max(0, targetStaffCount - activeStaffCount) : 0;
  const workingCount=clinicStaff.filter(s=>['working','late','checkout_pending'].includes(s.attendanceStatus??'')).length
    +shiftStaff.filter(s=>s.todayStatus==='근무중').length;

  if (isGigworker) {
    const [gigBoard,gigProjects]=await Promise.all([getGigOperationsBoard(context.user.id),listGigProjects()]);
    return <main className="px-4 pb-32">
      {shop.isDemo && <AdminInstallButton compact />}
      <GigOperationsBoard board={gigBoard} projects={gigProjects} facilityId={context.facilityId} facilityName={shop.name}/>
      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[{href:'/timesheet',label:'근태 기록',detail:'출퇴근·조퇴 확인'},{href:'/gig-pay',label:'지급 관리',detail:'금액·계좌·지급일'},{href:'/attendance-qr',label:'현장 인증',detail:'GPS·동적 QR'}].map((item)=><Link key={item.href} href={item.href} className="rounded-2xl bg-white p-4 shadow-sm active:bg-bg"><b className="text-[0.875rem] text-ink">{item.label}</b><span className="mt-1 block text-[0.6875rem] text-sub">{item.detail}</span><span className="mt-3 block text-right text-[0.875rem] font-bold text-primary">→</span></Link>)}
      </section>
      <Link href="/membership" className="mt-5 flex items-center justify-between rounded-xl bg-bg px-4 py-3 text-[0.75rem] text-sub"><span>긱워커 근태 무료 베타 · 최대 3명</span><b className="text-primary">이용 안내 →</b></Link>
      {shop.isDemo && (()=>{const workerOrigin=process.env.NEXT_PUBLIC_WORKER_WEB_URL??(process.env.NODE_ENV==='production'?'https://itdot.co.kr':'http://localhost:3003');const demoUrl=`${workerOrigin}/gig/demo`;return <section className="mt-4 rounded-2xl border border-primary/20 bg-white p-4 shadow-card"><div className="flex items-center gap-4"><QrCanvas value={demoUrl} size={112} label="워커 시연 QR"/><div className="min-w-0"><p className="text-[0.6875rem] font-extrabold tracking-[0.12em] text-primary">워커 기기</p><p className="mt-1 text-[0.9375rem] font-extrabold text-ink">이 QR을 찍으면 긱워커 시연 계정으로 바로 시작돼요</p><p className="mt-1 break-all text-[0.75rem] text-sub">{demoUrl}</p><p className="mt-1 text-[0.6875rem] text-sub">초대 수락 → 닿기 출근 → 이 화면에 반영. 다시 찍으면 처음부터.</p></div></div></section>;})()}
    </main>;
  }

  return (
    <main className="px-4">
      {shop.approvedAt === null && shop.registrationSource.startsWith('self_') && (
        <section role="status" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[0.875rem] font-bold text-amber-800">사업장 확인 중이에요</p>
          <p className="mt-1 text-[0.75rem] leading-5 text-amber-700">
            잇닿이 사업장 정보를 확인하면 공고 등록이 열려요. 보통 1영업일 안에 끝나요. 그동안 인력 등록과 근태 설정은 바로 쓸 수 있어요.
          </p>
          {brnFailed && <p role="alert" className="mt-2 text-[0.75rem] font-bold text-red-600">방금 올린 사업자 서류 전송이 실패했어요. 설정에서 다시 올려 주세요.</p>}
          {!shop.brnSubmitted && !shop.brnDocumentPath && (
            <Link href="/settings#brn-document" className="mt-2 inline-block rounded-lg bg-amber-600 px-3 py-1.5 text-[0.75rem] font-bold text-white">사업자등록번호·등록증 올리기 →</Link>
          )}
        </section>
      )}
      <div className="px-1 mt-2 mb-4">
        <p className="text-body text-sub">{shop.name}</p>
        <h1 className="text-display font-extrabold text-ink mt-1">{isPharmacy?'약국장님':'원장님'}, 안녕하세요 👋</h1>
      </div>
      {shop.isDemo && <AdminInstallButton compact />}

      {/* 첫 화면은 채용 공고보다 인력 공백과 다음 행동을 먼저 보여준다. */}
      <Card className={registeredShortage > 0 ? 'mb-4 border border-amber-200 bg-amber-50' : 'mb-4 shadow-sm'}>
        <p className="text-label font-bold text-primary">인력 운영 기준</p>
        {targetStaffCount > 0 ? (
          <div className="mt-2">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[1.75rem] leading-tight font-extrabold text-ink">
                  {registeredShortage > 0 ? `${registeredShortage}명 부족` : '기준 총원 충족'}
                </p>
                <p className="mt-1 text-body text-sub">기준 {targetStaffCount}명 중 등록 {activeStaffCount}명</p>
              </div>
              <Link href={registeredShortage > 0 ? '/staff' : '/operations#staffing-settings'} className="text-label font-bold text-primary whitespace-nowrap">
                {registeredShortage > 0 ? '직원 등록 →' : '운영 기준 →'}
              </Link>
            </div>
            {registeredShortage > 0 && <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-[0.75rem] leading-5 text-sub">총원 기준을 먼저 맞추면 휴가·결근이 생겼을 때 바로 대체 모집으로 이어갈 수 있어요.</p>}
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-4">
            <div>
              <p className="text-body font-extrabold text-ink">사업장 총원을 먼저 입력해 주세요</p>
              <p className="mt-1 text-[0.75rem] leading-5 text-sub">총원이 있어야 등록 직원과 비교해 부족 인원을 계산할 수 있어요.</p>
            </div>
            <Link href="/settings" className="shrink-0 text-label font-bold text-primary">입력 →</Link>
          </div>
        )}
      </Card>

      <Card className="shadow-sm">
        <p className="text-label font-bold text-primary">오늘 근무</p>
        <div className="mt-1 flex items-end justify-between gap-4">
          <div><p className="text-[1.75rem] leading-tight font-extrabold text-ink">{todayCount}명 예정</p><p className="mt-1 text-body text-sub">지금 {workingCount}명이 근무 중이에요</p></div>
          <Link href="/timesheet" className="text-label font-bold text-primary whitespace-nowrap">현황 보기 →</Link>
        </div>
      </Card>

      <section className="mt-4">
        <div className="mb-3 flex items-end justify-between px-1"><div><p className="text-[0.6875rem] font-bold text-primary">오늘 처리할 일</p><h2 className="mt-0.5 text-title font-extrabold text-ink">확인이 필요한 업무</h2></div><Link href="/more" className="text-[0.75rem] font-bold text-sub">전체 관리 →</Link></div>
        <Card className="divide-y divide-line p-0 overflow-hidden">
          {[
            // 대타 승인은 근무 직전에 생기는 일이라 가장 급하다 — 있을 때만 맨 위에
            ...(coverToApprove>0?[{label:'대타 승인',description:'못 나오게 된 근무를 동료가 맡겠다고 했어요',count:coverToApprove,href:'/applications#cover'}]:[]),
            {label:'새 지원자',description:'지원자를 확인하고 근무를 확정해요',count:pendingCount,href:'/applications'},
            {label:'출퇴근 확인',description:'조기 퇴근·미출근·인증 실패를 확인해요',count:attendanceReviewCount,href:'/timesheet'},
            {label:'지급 대기',description:canViewPayroll?'근무시간을 확인하고 지급을 완료해요':'급여 담당자에게 확인을 요청해요',count:canViewPayroll?ops.pendingWageCount:0,href:canViewPayroll?'/payroll':'/timesheet'},
          ].map((item)=><Link key={item.label} href={item.href} className="flex min-h-[72px] items-center justify-between gap-3 px-5 py-3 active:bg-bg">
            <div><p className="text-body font-extrabold text-ink">{item.label}</p><p className="mt-0.5 text-[0.75rem] text-sub">{item.description}</p></div>
            <span className={`flex min-w-[58px] items-center justify-end gap-1 text-[1.0625rem] font-extrabold ${item.count>0?'text-primary':'text-sub'}`}>{item.count}건 <span className="text-sub">›</span></span>
          </Link>)}
        </Card>
        {coverToApprove+pendingCount+attendanceReviewCount+(canViewPayroll?ops.pendingWageCount:0)===0&&<p className="mt-2 px-1 text-[0.75rem] font-medium text-success">오늘 바로 처리할 업무를 모두 마쳤어요.</p>}
      </section>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link href="/shifts/new" className="rounded-2xl bg-primary px-5 py-5 text-white shadow-btn active:opacity-85"><span className="text-[1.25rem]">＋</span><p className="mt-2 text-[1.0625rem] font-extrabold">근무자 모집</p><p className="mt-1 text-[0.75rem] text-white/80">날짜와 시간만 정하면 돼요</p></Link>
        <Link href="/timesheet" className="rounded-2xl bg-white px-5 py-5 active:bg-bg"><span className="text-[1.25rem]">◷</span><p className="mt-2 text-[1.0625rem] font-extrabold text-ink">오늘 근무 보기</p><p className="mt-1 text-[0.75rem] text-sub">출퇴근과 확인 요청을 봐요</p></Link>
      </div>
      {/* 긱워커 전용 근무지(/setup/claim-facility?mode=gigworker)는 사업장이 없는 관리자만 만들 수 있다(admin_user_id UNIQUE).
          기존 사업장은 직원 관리의 단기근무 등록으로 외부 단기근로자를 초대한다. */}
      <Link href="/staff?view=contract&entry=gigworker" className="mt-3 flex items-center justify-between rounded-xl bg-white px-4 py-3 active:bg-bg"><span><b className="text-[0.875rem] text-ink">외부 단기근로자 초대</b><span className="ml-2 text-[0.75rem] text-sub">당근 등에서 구한 인력의 날짜·시간을 정하고 링크를 보내요</span></span><span className="font-bold text-primary">→</span></Link>
      <div className="mt-3"><OperationsFlow compact/></div>
      <Link href="/workforce" className="mt-3 flex items-center justify-between rounded-xl bg-primary/5 px-4 py-3 text-label font-bold text-primary"><span>함께한 근무자 다시 요청</span><span>→</span></Link>

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
