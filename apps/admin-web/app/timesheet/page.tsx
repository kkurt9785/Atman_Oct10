import { Card, SectionTitle, StatusBadge } from '@/components/ui';
import { STAFF, hours } from '@/lib/mock';

export default function TimesheetPage() {
  return (
    <main className="px-4">
      <h1 className="text-display font-extrabold text-ink mt-3 mb-3 px-1">근태</h1>

      <Card className="shadow-sm flex items-center gap-3">
        <span className="text-3xl">📱</span>
        <p className="text-body text-ink">직원이 <b>QR로 출퇴근</b>하면 시간이 자동 기록돼요. (법정 전자기록·3년 보관)</p>
      </Card>

      <SectionTitle>오늘 출퇴근</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {STAFF.map((s) => (
          <div key={s.id} className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-body font-bold text-ink">{s.name}</p>
              <p className="text-label text-sub">이번 달 누적 {hours(s.monthMinutes)}</p>
            </div>
            <StatusBadge status={s.todayStatus} />
          </div>
        ))}
      </Card>
    </main>
  );
}
