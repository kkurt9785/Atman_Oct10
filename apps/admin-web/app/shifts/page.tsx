import Link from 'next/link';
import { getShifts, getExpiredOpenShifts, ShiftRow } from '@/lib/db/shifts';
import { Card } from '@/components/ui';
import { won, formatDate } from '@/lib/format';
import { CancelButton } from './CancelButton';
import { ExpiredShiftBanner } from './ExpiredShiftBanner';
import { OperationsFlow } from '@/components/OperationsFlow';

const ROLE_LABEL: Record<string, string> = { rn: '간호사', na: '간호조무사', pharmacist: '약사', pharmacy_staff: '약국 전산·사무직', any: '무관' };

const STATUS_STYLE: Record<string, string> = {
  open:        'bg-primary/10 text-primary',
  matched:     'bg-success/15 text-success',
  in_progress: 'bg-warn/15 text-warn',
  completed:   'bg-line text-sub',
  cancelled:   'bg-line text-sub',
};
const STATUS_LABEL: Record<string, string> = {
  open:        '모집중',
  matched:     '채용확정',
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
          <p className="text-label text-sub">{formatDate(s.shift_date)} · {ROLE_LABEL[s.required_role]}</p>
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
      {s.audience === 'targeted' && <p className="mb-1 inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-extrabold text-primary">요청받은 분만 보는 결원 근무</p>}
      <p className="text-body text-ink line-clamp-2">{s.description}</p>
      <div className="mt-3 pt-3 border-t border-line flex items-center justify-between">
        <span className="text-label text-sub">{s.hourly_wage.toLocaleString('ko-KR')}원/시간</span>
        <div className="flex items-center gap-3">{s.status === 'open' && s.audience !== 'invited' && <Link href={`/vacancy?shift=${s.id}`} className="text-[0.75rem] font-bold text-primary">사람 골라 요청</Link>}<Link href={`/shifts/new?copy=${s.id}`} className="text-[0.75rem] font-bold text-sub">조건 복사</Link><span className="text-body font-extrabold text-primary">{won(s.estimated_total_pay)}</span></div>
      </div>
    </Card>
  );
}

export default async function ShiftsPage() {
  const [shifts, expiredShifts] = await Promise.all([getShifts(), getExpiredOpenShifts()]);

  return (
    <main className="px-4 pb-24">
      <div className="flex items-center justify-between px-1 mt-2 mb-2">
        <h1 className="text-display font-extrabold text-ink">공고</h1>
        <Link
          href="/shifts/new"
          className="flex items-center gap-1.5 bg-primary text-white text-body font-bold px-4 py-2.5 rounded-xl active:opacity-90"
        >
          <span className="text-xl leading-none">+</span>
          <span>새 공고</span>
        </Link>
      </div>
      <div className="flex justify-end mb-4 px-1">
        <Link href="/operations" className="text-label font-bold text-primary">반복 일정·미충원 관리 →</Link>
      </div>
      <OperationsFlow active="recruit"/>

      <ExpiredShiftBanner shifts={expiredShifts} />

      {shifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-5xl">📋</span>
          <p className="text-title font-bold text-ink">올린 공고가 없어요</p>
          <p className="text-body text-sub text-center">새 공고를 올리면<br />자동으로 근무자에게 알림이 가요</p>
          <Link
            href="/shifts/new"
            className="mt-3 flex items-center justify-center min-h-tap rounded-xl bg-primary text-white text-body font-bold px-8 active:opacity-90"
          >
            첫 공고 올리기
          </Link>
        </div>
      ) : (
        shifts.map((s) => <ShiftCard key={s.id} s={s} />)
      )}
    </main>
  );
}
