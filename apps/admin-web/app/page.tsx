import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, SectionTitle, StatusBadge } from '@/components/ui';
import { getShop } from '@/lib/db/shop';
import { getStaff } from '@/lib/db/staff';
import { getPendingCount } from '@/lib/db/applications';
import { getOperationsSummary, getOperationsAlerts } from '@/lib/db/operations';
import { getClinicStaff } from '@/lib/db/clinic-workforce';
import { getAdminContext } from '@/lib/admin-auth';

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
  const facilityWord = isPharmacy ? '약국' : '병원';
  const noShowCount = alerts.filter((a) => a.kind === 'no_show').length;

  // 오늘 챙길 일 — 값이 있을 때만 노출 (평온한 날엔 조치 섹션 자체가 사라짐)
  const todos = [
    { key: 'pending', label: '지원 대기', count: pendingCount, href: '/applications', tone: 'primary' as const },
    { key: 'noshow', label: '노쇼 확인', count: noShowCount, href: '/operations', tone: 'danger' as const },
    { key: 'unfilled', label: '48시간 내 미충원', count: ops.urgentUnfilledCount, href: '/operations', tone: 'warn' as const },
    { key: 'credential', label: '자격 만료 임박', count: ops.expiringCredentialCount, href: '/workforce', tone: 'warn' as const },
    ...(canViewPayroll ? [{ key: 'wage', label: '지급 처리 대기', count: ops.pendingWageCount, href: '/payroll', tone: 'warn' as const }] : []),
  ].filter((t) => t.count > 0);

  const toneClass = {
    primary: 'text-primary',
    danger: 'text-red-600',
    warn: 'text-warn',
  };
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

      {/* ② 오늘 챙길 일 — 있을 때만 */}
      {todos.length > 0 && (
        <Card className="mt-4 border border-primary/20 p-0 overflow-hidden">
          <p className="text-label font-bold text-primary px-5 pt-4 pb-2">⚡ 오늘 챙길 일</p>
          <div className="divide-y divide-line">
            {todos.map((t) => (
              <Link key={t.key} href={t.href} className="flex items-center justify-between px-5 py-3.5 active:bg-bg">
                <span className="text-body text-ink">{t.label}</span>
                <span className="flex items-center gap-1.5">
                  <b className={`text-body ${toneClass[t.tone]}`}>{t.count}건</b>
                  <span className="text-sub">→</span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link href="/shifts/new" className="rounded-2xl bg-primary px-5 py-5 text-white shadow-btn active:opacity-85"><span className="text-[20px]">＋</span><p className="mt-2 text-[17px] font-extrabold">근무자 모집</p><p className="mt-1 text-[12px] text-white/80">날짜와 시간만 정하면 돼요</p></Link>
        <Link href="/timesheet" className="rounded-2xl bg-white px-5 py-5 active:bg-bg"><span className="text-[20px]">◷</span><p className="mt-2 text-[17px] font-extrabold text-ink">오늘 근무 보기</p><p className="mt-1 text-[12px] text-sub">출퇴근과 확인 요청을 봐요</p></Link>
      </div>
      {isPharmacy&&<Link href="/workforce" className="mt-3 flex items-center justify-between rounded-xl bg-primary/5 px-4 py-3 text-label font-bold text-primary"><span>함께 일한 약사 다시 부르기</span><span>→</span></Link>}

      {/* ⑤ 오늘 근무 */}
      <SectionTitle>진행 중인 근무</SectionTitle>
      {staff.length === 0&&clinicStaff.length===0 ? (
        <Card className="py-8 text-center">
          <p className="text-body font-bold text-ink">오늘 근무가 없어요</p>
          <p className="text-label text-sub mt-1">등록 직원 또는 지원 승인 근무가 생기면 표시됩니다.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {clinicStaff.map((s) => (
            <div key={`managed-${s.id}`} className="flex items-center justify-between px-5 py-4">
              <div><p className="text-body font-bold text-ink">{s.name}</p><p className="text-label text-sub">{s.department??'업무 미지정'} · {facilityWord} 등록 직원</p></div>
              <div className="text-right"><StatusBadge status={s.attendanceStatus==='working'||s.attendanceStatus==='late'||s.attendanceStatus==='checkout_pending'?'근무중':s.attendanceStatus==='completed'?'퇴근':s.attendanceStatus==='absent'?'결근':'예정'} /><p className="mt-1 text-[11px] text-sub">{s.attendanceStatus==='completed'?'다음: 지급 확인':s.attendanceStatus==='checkout_pending'?'다음: 퇴근 승인':s.attendanceStatus==='working'||s.attendanceStatus==='late'?'다음: 퇴근 확인':'근무 상태 확인'}</p></div>
            </div>
          ))}
          {shiftStaff.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-body font-bold text-ink">{s.name}</p>
                <p className="text-label text-sub">{s.job}</p>
              </div>
              <div className="text-right"><StatusBadge status={s.todayStatus} /><p className="mt-1 text-[11px] text-sub">{s.todayStatus==='퇴근'?'다음: 지급 확인':s.todayStatus==='근무중'?'다음: 퇴근 확인':'근무 상태 확인'}</p></div>
            </div>
          ))}
        </Card>
      )}

      {/* ⑥ SaaS 안내 — 최하단 한 줄 링크로 축소 */}
      <Link
        href="/membership"
        className="mt-6 mb-2 flex items-center justify-between px-4 py-3 rounded-xl bg-bg active:opacity-80"
      >
        <span className="text-label text-sub">
          워커 임금은 {facilityWord} 직접 지급 · 잇닿 이용료는 <b className="text-ink">별도 청구서</b>
        </span>
        <span className="text-label font-bold text-primary flex-shrink-0 ml-2">요금·청구 →</span>
      </Link>
    </main>
  );
}
