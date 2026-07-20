import { Card, SectionTitle, StatusBadge } from '@/components/ui';
import { getAdminContext } from '@/lib/admin-auth';
import { getStaff } from '@/lib/db/staff';
import { getPendingWorkers } from '@/lib/db/workers';
import { WorkerApprovalCard } from './WorkerApprovalCard';
import { hours } from '@/lib/format';

export default async function StaffPage() {
  const context = await getAdminContext();
  const canReviewWorkers = context?.accessRole === 'super';
  const [staff, pending] = await Promise.all([
    getStaff(),
    canReviewWorkers ? getPendingWorkers() : Promise.resolve([]),
  ]);

  return (
    <main className="px-4">
      <h1 className="text-display font-extrabold text-ink mt-3 mb-1 px-1">직원</h1>
      <p className="text-body text-sub px-1 mb-2">오늘 이 병원에 배정된 직원 {staff.length}명이에요</p>

      <SectionTitle>워커 면허 심사</SectionTitle>
      {!canReviewWorkers ? (
        <Card className="py-7 text-center">
          <p className="text-body font-bold text-ink">플랫폼 운영자 전용 기능이에요</p>
          <p className="text-label text-sub mt-1 break-keep">병원 관리자는 본인 병원의 지원자 서류만 지원 관리 화면에서 확인할 수 있어요.</p>
        </Card>
      ) : pending.length === 0 ? (
        <Card className="py-8 text-center">
          <p className="text-body font-bold text-ink">승인 대기 워커가 없어요</p>
          <p className="text-label text-sub mt-1">신규 가입자가 심사를 요청하면 여기에 표시됩니다.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {pending.map((worker) => (
            <WorkerApprovalCard key={worker.id} worker={worker} />
          ))}
        </Card>
      )}

      <SectionTitle>직원 목록</SectionTitle>
      {staff.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-body font-bold text-ink">오늘 배정된 직원이 없어요</p>
          <p className="text-label text-sub mt-1">병원이 채용확정한 워커가 여기에 표시됩니다.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {staff.map((worker) => (
            <div key={worker.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-body font-bold text-ink">{worker.name}</p>
                  {worker.isDemo && (
                    <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">데모</span>
                  )}
                </div>
                <p className="text-label text-sub">{worker.job} · 이번 달 {hours(worker.monthMinutes)}</p>
              </div>
              <StatusBadge status={worker.todayStatus} />
            </div>
          ))}
        </Card>
      )}
    </main>
  );
}
