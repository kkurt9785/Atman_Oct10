import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, SectionTitle, BigStat, ActionTile, StatusBadge } from '@/components/ui';
import { getShop } from '@/lib/db/shop';
import { getStaff, getSummary } from '@/lib/db/staff';
import { getPendingCount } from '@/lib/db/applications';
import { getBillingSummary } from '@/lib/db/billing';
import { won, hours } from '@/lib/mock';
import { recommendedTierForShortfall } from '@/lib/billing';

export default async function Home() {
  const [shop, staff, pendingCount, billing] = await Promise.all([
    getShop(),
    getStaff(),
    getPendingCount(),
    getBillingSummary(),
  ]);

  if (!shop) redirect('/setup/claim-facility');

  const summary = await getSummary(staff);
  const committedPay = billing.todayCommittedPay + billing.upcomingCommittedPay;
  const projectedBalance = billing.balance - committedPay;
  const shortfall = Math.max(0, -projectedBalance);
  const recommendedTier = recommendedTierForShortfall(shortfall || Math.max(billing.openExposurePay, 500000));

  return (
    <main className="px-4">
      <div className="px-1 mt-2 mb-4">
        <p className="text-body text-sub">{shop.name}</p>
        <h1 className="text-display font-extrabold text-ink mt-1">사장님, 안녕하세요 👋</h1>
      </div>

      <Card className="shadow-sm">
        <p className="text-label text-sub mb-3">이번 달 현황</p>
        <div className="flex justify-between items-end">
          <BigStat label="예상 인건비" value={won(summary.estimatedPay)} />
          <div className="text-right">
            <p className="text-label text-sub mb-1">총 근로시간</p>
            <p className="text-title font-bold text-ink">{hours(summary.totalMinutes)}</p>
          </div>
        </div>
        {shop.creditBalance > 0 && (
          <div className="mt-3 pt-3 border-t border-line flex items-center gap-2">
            <span className="text-label font-bold text-primary">🎁 크레딧 잔액</span>
            <span className="text-body font-bold text-ink">{won(shop.creditBalance)}</span>
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-line flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-success" />
          <span className="text-body text-ink">지금 <b>{summary.workingNow}명</b> 근무 중이에요</span>
        </div>
      </Card>

      <Card className={`mt-4 shadow-sm ${shortfall > 0 ? 'border border-warn/30' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-label font-bold text-sub">운영 가능 상태</p>
            <p className="text-title font-extrabold text-ink mt-1">
              {shortfall > 0 ? '충전이 필요해요' : '오늘 운영 가능해요'}
            </p>
          </div>
          <span className={`text-label font-bold px-3 py-1 rounded-full ${
            shortfall > 0 ? 'bg-warn/15 text-warn' : 'bg-success/15 text-success'
          }`}>
            {shortfall > 0 ? '부족' : '정상'}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bg-bg rounded-xl px-3 py-3">
            <p className="text-label text-sub">현재 크레딧</p>
            <p className="text-body font-extrabold text-ink mt-0.5">{won(billing.balance)}</p>
          </div>
          <div className="bg-bg rounded-xl px-3 py-3">
            <p className="text-label text-sub">확정 근무 예정</p>
            <p className="text-body font-extrabold text-ink mt-0.5">
              {billing.todayMatchedCount + billing.upcomingMatchedCount}명 · {won(committedPay)}
            </p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-label text-sub">
              {shortfall > 0 ? `부족 예상 ${won(shortfall)}` : `매칭 가능 여유 ${won(projectedBalance)}`}
            </p>
            <p className="text-label text-sub mt-0.5">추천 충전 {recommendedTier.label}</p>
          </div>
          <Link
            href={`/membership?amount=${recommendedTier.charge}`}
            className="h-10 px-4 rounded-xl bg-primary text-white text-label font-bold flex items-center justify-center flex-shrink-0"
          >
            충전하기
          </Link>
        </div>
      </Card>

      {pendingCount > 0 && (
        <Link href="/applications">
          <div className="mt-4 bg-primary/10 border border-primary/20 rounded-2xl px-5 py-4 flex items-center justify-between active:opacity-80">
            <div>
              <p className="text-label font-bold text-primary">⚡ 처리 필요</p>
              <p className="text-body font-bold text-ink mt-0.5">지원 대기 {pendingCount}건</p>
            </div>
            <span className="text-sub text-xl">→</span>
          </div>
        </Link>
      )}

      <SectionTitle>빠른 메뉴</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <ActionTile icon="📋" label="시프트 등록" href="/shifts/new" />
        <ActionTile icon="🔲" label="QR 체크인" href="/checkin" />
        <ActionTile icon="🕐" label="근태 보기" href="/timesheet" />
        <ActionTile icon="📄" label="급여명세서 발급" href="/payroll" />
        <ActionTile icon="🎁" label="멤버십·크레딧" href="/membership" />
        <ActionTile icon="🏥" label="병원 프로필" href="/settings" />
      </div>

      <SectionTitle>오늘 근무</SectionTitle>
      {staff.length === 0 ? (
        <Card className="py-8 text-center">
          <p className="text-body font-bold text-ink">오늘 근무가 없어요</p>
          <p className="text-label text-sub mt-1">매칭된 시프트가 생기면 표시됩니다.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {staff.map((s) => (
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
    </main>
  );
}
