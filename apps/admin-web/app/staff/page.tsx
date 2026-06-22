import { Card, SectionTitle, StatusBadge, PrimaryButton } from '@/components/ui';
import { STAFF, hours } from '@/lib/mock';

export default function StaffPage() {
  return (
    <main className="px-4">
      <h1 className="text-display font-extrabold text-ink mt-3 mb-1 px-1">직원</h1>
      <p className="text-body text-sub px-1 mb-2">우리 가게 직원 {STAFF.length}명이에요</p>

      <SectionTitle>직원 목록</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {STAFF.map((s) => (
          <div key={s.id} className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-body font-bold text-ink">{s.name}</p>
              <p className="text-label text-sub">{s.job} · 이번 달 {hours(s.monthMinutes)}</p>
            </div>
            <StatusBadge status={s.todayStatus} />
          </div>
        ))}
      </Card>

      <div className="mt-5">
        <PrimaryButton href="/staff">➕ 직원 추가하기</PrimaryButton>
      </div>
    </main>
  );
}
