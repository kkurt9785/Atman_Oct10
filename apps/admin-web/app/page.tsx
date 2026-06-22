import { Card, SectionTitle, BigStat, ActionTile, StatusBadge } from '@/components/ui';
import { SHOP, STAFF, SUMMARY, won, hours } from '@/lib/mock';

export default function Home() {
  return (
    <main className="px-4">
      {/* 인사 (해요체·긍정형) */}
      <div className="px-1 mt-2 mb-4">
        <p className="text-body text-sub">{SHOP.name}</p>
        <h1 className="text-display font-extrabold text-ink mt-1">사장님, 안녕하세요 👋</h1>
      </div>

      {/* 이번 달 요약 — 금액 크게 */}
      <Card className="shadow-sm">
        <p className="text-label text-sub mb-3">이번 달 현황</p>
        <div className="flex justify-between items-end">
          <BigStat label="예상 인건비" value={won(SUMMARY.estimatedPay)} />
          <div className="text-right">
            <p className="text-label text-sub mb-1">총 근로시간</p>
            <p className="text-title font-bold text-ink">{hours(SUMMARY.totalMinutes)}</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-line flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-success" />
          <span className="text-body text-ink">지금 <b>{SUMMARY.workingNow}명</b> 근무 중이에요</span>
        </div>
      </Card>

      {/* 빠른 메뉴 — 큰 아이콘, 한 동작 */}
      <SectionTitle>빠른 메뉴</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <ActionTile icon="📄" label="급여명세서 발급" href="/payroll" />
        <ActionTile icon="🕐" label="근태 보기" href="/timesheet" />
        <ActionTile icon="➕" label="직원 추가" href="/staff" />
        <ActionTile icon="🛡️" label="법규 알림" href="/payroll" />
      </div>

      {/* 오늘 근무 직원 */}
      <SectionTitle>오늘 근무</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {STAFF.map((s) => (
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
