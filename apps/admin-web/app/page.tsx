import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, SectionTitle, BigStat, StatusBadge } from '@/components/ui';
import { QuickMenu } from '@/components/home/QuickMenu';
import { getShop } from '@/lib/db/shop';
import { getStaff } from '@/lib/db/staff';
import { getPendingCount } from '@/lib/db/applications';
import { getOperationsSummary, getOperationsAlerts } from '@/lib/db/operations';
import { won, hours } from '@/lib/format';
import { getUnifiedWorkforceSummary } from '@/lib/db/payroll';
import { getClinicStaff } from '@/lib/db/clinic-workforce';
import { getAdminContext } from '@/lib/admin-auth';

export default async function Home() {
  const [shop, staff, clinicStaff, workforceSummary, pendingCount, ops, alerts, context] = await Promise.all([
    getShop(),
    getStaff(),
    getClinicStaff(),
    getUnifiedWorkforceSummary(),
    getPendingCount(),
    getOperationsSummary(),
    getOperationsAlerts(),
    getAdminContext(),
  ]);
  const canViewPayroll = context?.canViewPayroll ?? false;

  if (!shop) redirect('/setup/claim-facility');

  const summary = workforceSummary;
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

  return (
    <main className="px-4">
      <div className="px-1 mt-2 mb-4">
        <p className="text-body text-sub">{shop.name}</p>
        <h1 className="text-display font-extrabold text-ink mt-1">{isPharmacy?'약국장님':'원장님'}, 안녕하세요 👋</h1>
      </div>

      {/* ① 이번 달 현황 */}
      <Card className="shadow-sm">
        <p className="text-label text-sub mb-3">이번 달 현황</p>
        <div className="flex justify-between items-end">
          {canViewPayroll
            ? <BigStat label="예상 인건비" value={won(summary.estimatedPay)} />
            : <BigStat label="등록 직원" value={`${staff.length + clinicStaff.length}명`} />}
          <div className="text-right">
            <p className="text-label text-sub mb-1">총 근로시간</p>
            <p className="text-title font-bold text-ink">{hours(summary.totalMinutes)}</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-line flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-success" />
          <span className="text-body text-ink">지금 <b>{summary.workingNow}명</b> 근무 중이에요</span>
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
      {isPharmacy&&(
        <Link href="/workforce" className="mt-4 block rounded-2xl border border-primary/20 bg-primary/5 p-5 active:opacity-80">
          <p className="text-[12px] font-bold text-primary">약국 운영의 핵심</p>
          <div className="mt-1 flex items-center justify-between gap-3"><div><h2 className="text-[17px] font-extrabold text-ink">함께 일한 약사에게 다시 요청</h2><p className="mt-1 text-[12px] leading-5 text-sub">검증된 대체약사를 인력풀에서 찾아 다음 근무를 바로 요청하세요.</p></div><span className="text-[22px] text-primary">→</span></div>
        </Link>
      )}

      {/* ③④ 빠른 메뉴 (자주 쓰는 4 + 더보기 접기) */}
      <SectionTitle>빠른 메뉴</SectionTitle>
      <QuickMenu
        primary={[
          { icon: '📋', label: '시프트 등록', href: '/shifts/new' },
          { icon: '🕐', label: '오늘 근태', href: '/timesheet' },
          { icon: '🧑‍⚕️', label: '직원 관리', href: '/staff' },
          { icon: '🌿', label: '휴가 관리', href: '/leave' },
        ]}
        more={[
          { icon: '📍', label: '출퇴근 인증', href: '/attendance-qr' },
          { icon: '📷', label: '워커 QR 스캔', href: '/checkin' },
          { icon: '🤝', label: `${facilityWord} 인력풀`, href: '/workforce' },
          { icon: '⚙️', label: '운영 자동화', href: '/operations' },
          { icon: '💬', label: '워커 채팅', href: '/chats' },
          ...(canViewPayroll ? [{ icon: '₩', label: '급여 자료', href: '/payroll' }] : []),
          { icon: '🧾', label: '요금·청구', href: '/membership' },
          { icon: isPharmacy ? '💊' : '🏥', label: `${facilityWord} 프로필`, href: '/settings' },
        ]}
      />

      {/* ⑤ 오늘 근무 */}
      <SectionTitle>오늘 근무</SectionTitle>
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
              <StatusBadge status={s.attendanceStatus==='working'||s.attendanceStatus==='late'||s.attendanceStatus==='checkout_pending'?'근무중':s.attendanceStatus==='completed'?'퇴근':s.attendanceStatus==='absent'?'결근':'예정'} />
            </div>
          ))}
          {staff.filter((shift)=>!clinicStaff.some((managed)=>managed.workerId===shift.id)).map((s) => (
            <div key={s.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-body font-bold text-ink">{s.name}</p>
                <p className="text-label text-sub">{s.job}</p>
              </div>
              <StatusBadge status={s.todayStatus} />
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
