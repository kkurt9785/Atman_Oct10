import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui';
import { getShop } from '@/lib/db/shop';
import { isPlatformAdminUser } from '@/lib/platform-admin';
import { getStaff } from '@/lib/db/staff';
import { getPendingCount } from '@/lib/db/applications';
import { getOperationsSummary, getOperationsAlerts } from '@/lib/db/operations';
import { getClinicStaff, getPendingLeaveCount, getTodayAttendanceFailures } from '@/lib/db/clinic-workforce';
import { getAdminContext } from '@/lib/admin-auth';
import { OperationsFlow } from '@/components/OperationsFlow';
import { QrCanvas } from '@/components/QrCanvas';
import { GigOperationsBoard } from '@/components/GigOperationsBoard';
import { getGigOperationsBoard } from '@/lib/db/gig-operations';
import { listGigProjects } from '@/lib/db/gig-projects';
import { getActiveCoverRequests } from '@/lib/db/cover';
import { adminClient } from '@/lib/supabase';
import { getGigBetaStatus } from '@/lib/billing-gates';
import { BetaGuide } from '@/components/BetaGuide';
import { isGuidePeriod } from '@/lib/db/guide';
import { attendanceReviewCount as countAttendanceReview, todayHeadcount } from '@/lib/today-headcount';
import { getMissingCheckouts } from '@/lib/db/missing-checkouts';

export default async function Home({ searchParams }: { searchParams: Promise<{ brn?: string }> }) {
  const brnFailed = (await searchParams).brn === 'failed';
  const [shop, staff, clinicStaff, attendanceFailures, pendingCount, ops, alerts, context, covers, pendingLeaveCount, missingCheckouts] = await Promise.all([
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
    getPendingLeaveCount().catch(() => 0),
    // 퇴근 누락(오래된 것 포함) — 조회 실패 시 0건
    getMissingCheckouts(),
  ]);
  if (!context) redirect('/login');
  const canViewPayroll = context?.canViewPayroll ?? false;

  // 잇닿 운영 계정은 사업장이 없어도 승인 화면으로 바로 간다. 일반 관리자는 사업장 연결부터.
  if (!shop) redirect(isPlatformAdminUser(context?.user) ? '/ops/facilities' : '/setup/claim-facility');

  const isGigworker = shop.mode === 'gig';
  const noShowCount = alerts.filter((a) => a.kind === 'no_show').length;
  const coverToApprove = covers.filter((cover) => cover.status === 'claimed').length;
  const attendanceReviewCount = countAttendanceReview(clinicStaff, noShowCount, attendanceFailures.length, missingCheckouts.total);
  const shiftStaff=staff.filter(shift=>!clinicStaff.some(managed=>managed.workerId===shift.id));
  // 근태 '오늘 근무자' 탭과 같은 함수로 센다 — 휴가 제외·확인 필요 포함·같은 사람은 1명
  const todayCount=todayHeadcount(clinicStaff,staff).working;
  const activeStaffCount = clinicStaff.filter((row) => row.status !== 'ended').length;
  const endedStaffCount = clinicStaff.length - activeStaffCount;
  // 우리 직원을 등록해 쓰는 사업장(의원·약국)은 모집보다 출퇴근·휴가가 먼저다
  const staffFirst = activeStaffCount > 0;
  const targetStaffCount = shop.employeeCount ?? 0;
  const registeredShortage = targetStaffCount > 0 ? Math.max(0, targetStaffCount - activeStaffCount) : 0;
  const workingCount=clinicStaff.filter(s=>['working','late','checkout_pending'].includes(s.attendanceStatus??'')).length
    +shiftStaff.filter(s=>s.todayStatus==='근무중').length;

  if (isGigworker) {
    const [gigBoard,gigProjects]=await Promise.all([getGigOperationsBoard(context.user.id),listGigProjects()]);
    // 무료 베타 한 달(10명). 시연 사업장은 기간이 없다.
    const betaSb=shop.isDemo?null:adminClient();
    const beta=betaSb?await getGigBetaStatus(betaSb,context.facilityId).catch(()=>null):null;
    const betaLine=beta?.inBeta&&beta.lastDay?`무료 베타 · 10명까지 · ${Number(beta.lastDay.slice(5,7))}/${Number(beta.lastDay.slice(8,10))}까지 (${beta.daysLeft}일 남음)`:'무료 베타 · 10명까지 · 한 달 (초대 대기 포함)';
    return <main className="px-4 pb-32">
      <GigOperationsBoard board={canViewPayroll?gigBoard:{...gigBoard,summary:{...gigBoard.summary,pay:0},workers:gigBoard.workers.map(row=>({...row,unpaidDays:0,bankShared:false,...(['pay','bank','paid'].includes(row.status)?{status:'off' as const,statusLabel:'근무 기록 확인'}:{})}))}} projects={canViewPayroll?gigProjects:gigProjects.map(project=>({...project,payRate:null}))} facilityId={context.facilityId} facilityName={shop.name} canViewPayroll={canViewPayroll}/>
      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[{href:'/timesheet',label:'오늘 근태',detail:'출퇴근·조퇴 확인'},{href:'/gig-pay',label:'지급 관리',detail:'금액·계좌·지급일'},{href:'/attendance-qr',label:'현장 인증',detail:'위치·QR 설정'}].filter(item=>canViewPayroll||item.href!=='/gig-pay').map((item)=><Link key={item.href} href={item.href} className="rounded-2xl bg-white p-4 shadow-sm active:bg-bg"><b className="text-[0.875rem] text-ink">{item.label}</b><span className="mt-1 block text-[0.6875rem] text-sub">{item.detail}</span><span className="mt-3 block text-right text-[0.875rem] font-bold text-primary">→</span></Link>)}
      </section>
      <Link href="/membership" className="mt-5 flex items-center justify-between rounded-xl bg-bg px-4 py-3 text-[0.75rem] text-sub"><span>{betaLine}</span><b className="text-primary">이용 현황 →</b></Link>
      {shop.isDemo && (()=>{const workerOrigin=process.env.NEXT_PUBLIC_WORKER_WEB_URL??(process.env.NODE_ENV==='production'?'https://itdot.co.kr':'http://localhost:3003');const demoUrl=`${workerOrigin}/gig/demo`;return <section className="mt-4 rounded-2xl border border-primary/20 bg-white p-4 shadow-card"><div className="flex items-center gap-4"><QrCanvas value={demoUrl} size={112} label="근무자 시연 QR"/><div className="min-w-0"><p className="text-[0.6875rem] font-extrabold tracking-[0.12em] text-primary">근무자 폰</p><p className="mt-1 text-[0.9375rem] font-extrabold text-ink">이 QR을 찍으면 근무자 시연 계정으로 바로 시작돼요</p><p className="mt-1 break-all text-[0.75rem] text-sub">{demoUrl}</p><p className="mt-1 text-[0.6875rem] text-sub">초대 수락 → 출근하기 → 이 화면에 반영. 다시 찍으면 처음부터.</p></div></div></section>;})()}
    </main>;
  }

  return (
    <main className="px-4">
      {shop.approvedAt === null && shop.registrationSource.startsWith('self_') && (
        <section role="status" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[0.875rem] font-bold text-amber-800">사업장 확인 중이에요</p>
          <p className="mt-1 text-[0.75rem] leading-5 text-amber-700">
            직원 등록·출퇴근·연차 관리는 지금 바로 쓸 수 있어요. 단기 인력 공고 등록만 잇닿이 사업장 정보를 확인한 뒤 열려요. 보통 1영업일 안에 끝나요.
          </p>
          {brnFailed && <p role="alert" className="mt-2 text-[0.75rem] font-bold text-red-600">방금 올린 사업자 서류 전송이 실패했어요. 설정에서 다시 올려 주세요.</p>}
          {!shop.brnSubmitted && !shop.brnDocumentPath && (
            <Link href="/settings?section=brn" className="mt-2 inline-block rounded-lg bg-amber-600 px-3 py-1.5 text-[0.75rem] font-bold text-white">사업자등록번호·등록증 올리기 →</Link>
          )}
        </section>
      )}
      <div className="px-1 mt-2 mb-4">
        <p className="text-body text-sub">{shop.name}</p>
        <h1 className="text-display font-extrabold text-ink mt-1">안녕하세요 👋</h1>
      </div>
      {/* 가장 자주 하는 일 — 작은 폰(375×667) 첫 화면에서도 보이게 인사말 바로 아래 */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        {staffFirst
          ? <Link href="/timesheet" className="flex min-h-tap items-center justify-center rounded-2xl bg-primary text-body font-extrabold text-white shadow-btn active:opacity-85">오늘 출퇴근</Link>
          : <Link href="/staff" className="flex min-h-tap items-center justify-center gap-1.5 rounded-2xl bg-primary text-body font-extrabold text-white shadow-btn active:opacity-85"><span className="text-[1.25rem] leading-none">＋</span>직원 등록</Link>}
        <Link href="/shifts/new" className="flex min-h-tap items-center justify-center gap-1.5 rounded-2xl border border-primary/30 bg-white text-body font-extrabold text-primary active:bg-bg"><span className="text-[1.25rem] leading-none">＋</span>근무자 모집</Link>
      </div>

      {/* 베타 기간 사용 안내 — 닫거나 세 단계를 끝내거나 체험 기간이 지나면 사라진다 */}
      {await isGuidePeriod() && <BetaGuide id="admin-home" title="세 단계면 출퇴근 관리가 시작돼요" steps={[
        { text: '직원을 등록해요. 이름과 근무 형태만 넣으면 돼요.', href: '/staff#staff-register', cta: '직원 등록', done: clinicStaff.length > 0 },
        { text: '직원 카드의 [초대 보내기]로 링크를 보내요. 직원이 링크를 열어 수락하면 이어져요.', href: '/staff', cta: '직원 관리', done: clinicStaff.some((s) => Boolean(s.workerId)) },
        { text: '직원이 근무자 앱에서 [출근하기]를 길게 누르면 오늘 출퇴근에 바로 보여요.', href: '/timesheet', cta: '오늘 출퇴근' },
      ]} note="이 안내는 체험 기간에만 보여요. 닫아도 설정에서 다시 볼 수 있어요." />}

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
                <p className="mt-1 text-body text-sub">기준 {targetStaffCount}명 중 등록 {activeStaffCount}명{endedStaffCount>0?` · 계약 종료 ${endedStaffCount}명 제외`:''}</p>
              </div>
              <Link href={registeredShortage > 0 ? '/staff' : '/operations#staffing-settings'} className="text-label font-bold text-primary whitespace-nowrap">
                {registeredShortage > 0 ? '직원 등록 →' : '운영 기준 →'}
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-4">
            <div>
              <p className="text-body font-extrabold text-ink">사업장 총원을 먼저 입력해 주세요</p>
              <p className="mt-1 text-[0.75rem] leading-5 text-sub">총원이 있어야 등록 직원과 비교해 부족 인원을 계산할 수 있어요.</p>
            </div>
            <Link href="/settings?section=profile" className="shrink-0 text-label font-bold text-primary">입력 →</Link>
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
            {label:'출퇴근 확인',description:missingCheckouts.total>0?`퇴근 기록 없는 근무 ${missingCheckouts.total}건 · 조기 퇴근·미출근·인증 실패`:'조기 퇴근·미출근·퇴근 누락·인증 실패를 확인해요',count:attendanceReviewCount,href:missingCheckouts.total>0?'/timesheet#missing-checkout':'/timesheet'},
            {label:'연차 신청',description:'직원이 신청한 연차·휴가를 승인하거나 반려해요',count:pendingLeaveCount,href:'/leave'},
            {label:'새 지원자',description:'지원자를 확인하고 근무를 확정해요',count:pendingCount,href:'/applications'},
            {label:'지급 대기',description:canViewPayroll?(ops.pendingWageMonth?`${Number(ops.pendingWageMonth.slice(5,7))}월 급여 · 근무시간을 확인하고 지급을 완료해요`:'근무시간을 확인하고 지급을 완료해요'):'급여 담당자에게 확인을 요청해요',count:canViewPayroll?ops.pendingWageCount:0,href:canViewPayroll?(ops.pendingWageMonth?`/payroll?month=${ops.pendingWageMonth}${ops.pendingWageTab?`&tab=${ops.pendingWageTab}`:''}`:'/payroll'):'/timesheet'},
          ].map((item)=><Link key={item.label} href={item.href} className="flex min-h-[72px] items-center justify-between gap-3 px-5 py-3 active:bg-bg">
            <div><p className="text-body font-extrabold text-ink">{item.label}</p><p className="mt-0.5 text-[0.75rem] text-sub">{item.description}</p></div>
            <span className={`flex min-w-[58px] items-center justify-end gap-1 text-[1.0625rem] font-extrabold ${item.count>0?'text-primary':'text-sub'}`}>{item.count}건 <span className="text-sub">›</span></span>
          </Link>)}
        </Card>
        {coverToApprove+pendingCount+pendingLeaveCount+attendanceReviewCount+(canViewPayroll?ops.pendingWageCount:0)===0&&<p className="mt-2 px-1 text-[0.75rem] font-medium text-success">오늘 바로 처리할 업무를 모두 마쳤어요.</p>}
      </section>
      {/* 긱워커 전용 근무지(/setup/claim-facility?mode=gigworker)는 사업장이 없는 관리자만 만들 수 있다(admin_user_id UNIQUE).
          기존 사업장은 직원 관리의 단기근무 등록으로 외부 단기근로자를 초대한다. */}
      <Link href="/staff?view=contract&entry=gigworker" className="mt-4 flex items-center justify-between rounded-xl bg-white px-4 py-3 active:bg-bg"><span><b className="text-[0.875rem] text-ink">외부 단기 근무자 초대</b><span className="ml-2 text-[0.75rem] text-sub">당근 등에서 구한 인력의 날짜·시간을 정하고 링크를 보내요</span></span><span className="font-bold text-primary">→</span></Link>
      <div className="mt-3"><OperationsFlow compact variant={staffFirst?'staff':'recruit'}/></div>
      <Link href="/workforce" className="mt-3 flex items-center justify-between rounded-xl bg-primary/5 px-4 py-3 text-label font-bold text-primary"><span>함께한 근무자 다시 요청</span><span>→</span></Link>

      {/* ⑥ SaaS 안내 — 최하단 한 줄 링크로 축소 */}
      <Link
        href="/membership"
        className="mt-6 mb-2 flex items-center justify-between px-4 py-3 rounded-xl bg-bg active:opacity-80"
      >
        <span className="text-label text-sub">
          채용 수수료 <b className="text-ink">0원</b> — 잇닿은 월 이용료만 받아요
        </span>
        <span className="text-label font-bold text-primary flex-shrink-0 ml-2">요금·청구 →</span>
      </Link>
    </main>
  );
}
