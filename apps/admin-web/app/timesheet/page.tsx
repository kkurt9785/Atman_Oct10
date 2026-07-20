import { Card, SectionTitle } from '@/components/ui';
import { getStaff, getSummary } from '@/lib/db/staff';
import { hours } from '@/lib/format';

function fmtTime(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const STATUS_STYLE: Record<string, string> = {
  '근무중': 'bg-[#E5FAF4] text-success',
  '퇴근':   'bg-[#F2F4F6] text-sub',
  '예정':   'bg-primary/10 text-primary',
  '결근':   'bg-red-50 text-red-500',
};

export default async function TimesheetPage() {
  const staff   = await getStaff();
  const summary = await getSummary(staff);

  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  return (
    <main className="px-4">
      <h1 className="text-display font-extrabold text-ink mt-3 mb-1 px-1">근태</h1>
      <p className="text-label text-sub px-1 mb-4">{today}</p>

      {/* 이번 달 요약 */}
      <Card className="shadow-sm flex items-center gap-6 mb-2">
        <div>
          <p className="text-label text-sub">총 근무시간</p>
          <p className="text-title font-bold text-ink">{hours(summary.totalMinutes)}</p>
        </div>
        <div>
          <p className="text-label text-sub">근무 중</p>
          <p className="text-title font-bold text-primary">{summary.workingNow}명</p>
        </div>
        <div>
          <p className="text-label text-sub">예상 인건비</p>
          <p className="text-title font-bold text-ink">{summary.estimatedPay.toLocaleString('ko-KR')}원</p>
        </div>
      </Card>

      <SectionTitle>오늘 출퇴근</SectionTitle>
      {staff.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-body font-bold text-ink">오늘 출퇴근 기록이 없어요</p>
          <p className="text-label text-sub mt-1">QR 체크인이 발생하면 여기에 쌓입니다.</p>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {staff.map((s) => {
            const inTime  = fmtTime(s.checkInAt);
            const outTime = fmtTime(s.checkOutAt);

            return (
              <div key={s.id} className="px-5 py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-body font-bold text-ink">{s.name}</p>
                    <p className="text-label text-sub">{s.job}</p>
                  </div>
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_STYLE[s.todayStatus]}`}>
                    {s.todayStatus}
                  </span>
                </div>

                {/* 체크인/아웃 시간 */}
                <div className="mt-2 flex items-center gap-3 text-label text-sub">
                  {inTime ? (
                    <>
                      <span>🟢 {inTime} 출근</span>
                      {outTime && <span>→ {outTime} 퇴근</span>}
                    </>
                  ) : (
                    <span className="text-sub">아직 출근 전</span>
                  )}
                </div>

                {/* 이번 달 누적 */}
                <p className="text-label text-sub mt-1">
                  이번 달 누적 {hours(s.monthMinutes)}
                </p>
              </div>
            );
          })}
        </Card>
      )}

      <p className="text-label text-sub mt-3 px-1">
        QR 체크인 기록 기준 · 법정 전자기록 3년 보관
      </p>
    </main>
  );
}
