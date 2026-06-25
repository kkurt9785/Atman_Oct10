import { Card, SectionTitle, BigStat, ActionTile, StatusBadge } from '@/components/ui';
import { getShop } from '@/lib/db/shop';
import { getStaff, getSummary } from '@/lib/db/staff';
import { won, hours } from '@/lib/mock';

export default async function Home() {
  const [shop, staff] = await Promise.all([getShop(), getStaff()]);
  const summary = await getSummary(staff);

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

      <SectionTitle>빠른 메뉴</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <ActionTile icon="📄" label="급여명세서 발급" href="/payroll" />
        <ActionTile icon="🕐" label="근태 보기" href="/timesheet" />
        <ActionTile icon="➕" label="직원 추가" href="/staff" />
        <ActionTile icon="🎁" label="멤버십·크레딧" href="/membership" />
      </div>

      <SectionTitle>오늘 근무</SectionTitle>
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
    </main>
  );
}
