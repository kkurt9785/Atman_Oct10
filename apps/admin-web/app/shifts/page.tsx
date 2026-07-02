import Link from 'next/link';
import { getShifts, getExpiredOpenShifts, ShiftRow } from '@/lib/db/shifts';
import { Card } from '@/components/ui';
import { won } from '@/lib/mock';
import { CancelButton } from './CancelButton';
import { ExpiredShiftBanner } from './ExpiredShiftBanner';

const ROLE_LABEL: Record<string, string> = { rn: '간호사', na: '간호조무사', any: '무관' };

const STATUS_STYLE: Record<string, string> = {
  open:        'bg-primary/10 text-primary',
  matched:     'bg-success/15 text-success',
  in_progress: 'bg-warn/15 text-warn',
  completed:   'bg-line text-sub',
  cancelled:   'bg-line text-sub',
};
const STATUS_LABEL: Record<string, string> = {
  open:        '모집중',
  matched:     '매칭완료',
  in_progress: '근무중',
  completed:   '완료',
  cancelled:   '취소됨',
};

function ShiftCard({ s }: { s: ShiftRow }) {
  const timeRange = `${s.start_time.slice(0, 5)} – ${s.end_time.slice(0, 5)}${s.is_overnight ? ' (익일)' : ''}`;
  const isCancellable = s.status === 'open' || s.status === 'matched';

  return (
    <Card className="mb-3 shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex-1">
          <p className="text-label text-sub">{s.shift_date} · {ROLE_LABEL[s.required_role]}</p>
          <p className="text-title font-bold text-ink mt-0.5">{timeRange}</p>
        </div>
        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
          <span className={`text-label font-bold px-3 py-1 rounded-full ${STATUS_STYLE[s.status]}`}>
            {STATUS_LABEL[s.status]}
          </span>
          {isCancellable && <CancelButton shiftId={s.id} />}
        </div>
      </div>
      {s.department && (
        <p className="text-label text-sub mb-1">{s.department}</p>
      )}
      <p className="text-body text-ink line-clamp-2">{s.description}</p>
      <div className="mt-3 pt-3 border-t border-line flex items-center justify-between">
        <span className="text-label text-sub">{s.hourly_wage.toLocaleString('ko-KR')}원/시간</span>
        <span className="text-body font-extrabold text-primary">{won(s.estimated_total_pay)}</span>
      </div>
    </Card>
  );
}

export default async function ShiftsPage() {
  const [shifts, expiredShifts] = await Promise.all([getShifts(), getExpiredOpenShifts()]);

  return (
    <main className="px-4 pb-24">
      <div className="flex items-center justify-between px-1 mt-2 mb-5">
        <h1 className="text-display font-extrabold text-ink">시프트</h1>
        <Link
          href="/shifts/new"
          className="flex items-center gap-1.5 bg-primary text-white text-body font-bold px-4 py-2.5 rounded-xl active:opacity-90"
        >
          <span className="text-xl leading-none">+</span>
          <span>새 시프트</span>
        </Link>
      </div>

      <ExpiredShiftBanner shifts={expiredShifts} />

      {shifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-5xl">📋</span>
          <p className="text-title font-bold text-ink">등록된 시프트가 없어요</p>
          <p className="text-body text-sub text-center">새 시프트를 등록하면<br />자동으로 워커에게 알림이 가요</p>
          <Link
            href="/shifts/new"
            className="mt-3 flex items-center justify-center min-h-tap rounded-xl bg-primary text-white text-body font-bold px-8 active:opacity-90"
          >
            첫 시프트 등록하기
          </Link>
        </div>
      ) : (
        shifts.map((s) => <ShiftCard key={s.id} s={s} />)
      )}
    </main>
  );
}
