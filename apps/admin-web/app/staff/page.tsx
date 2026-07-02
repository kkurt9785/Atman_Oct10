import { Card, SectionTitle, StatusBadge } from '@/components/ui';
import { getStaff } from '@/lib/db/staff';
import { hours } from '@/lib/mock';

export default async function StaffPage() {
  const staff = await getStaff();

  return (
    <main className="px-4">
      <h1 className="text-display font-extrabold text-ink mt-3 mb-1 px-1">직원</h1>
      <p className="text-body text-sub px-1 mb-2">우리 가게 직원 {staff.length}명이에요</p>

      <SectionTitle>직원 목록</SectionTitle>
      {staff.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-body font-bold text-ink">오늘 배정된 직원이 없어요</p>
          <p className="text-label text-sub mt-1">시프트가 매칭되면 여기에 표시됩니다.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {staff.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-body font-bold text-ink">{s.name}</p>
                <p className="text-label text-sub">{s.job} · 이번 달 {hours(s.monthMinutes)}</p>
              </div>
              <StatusBadge status={s.todayStatus} />
            </div>
          ))}
        </Card>
      )}
    </main>
  );
}
