import Link from 'next/link';
import { Card } from '@/components/ui';
import { missingCheckoutHref, MISSING_CHECKOUT_LIST_LIMIT, type MissingCheckout } from '@/lib/missing-checkouts';

const dateLabel = (ymd: string) =>
  new Date(`${ymd}T12:00:00+09:00`).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });

// 퇴근 가능 시간이 지나도록 퇴근 기록이 없는 근태 — 날짜와 상관없이 오래된 순으로 보여 준다(D2).
// 근무자는 더 이상 스스로 퇴근을 찍을 수 없어서, 퇴근시간을 넣어야 근무시간이 급여에 들어간다.
export function MissingCheckoutCard({ items, total }: { items: MissingCheckout[]; total: number }) {
  if (total === 0) return null;
  return (
    <Card className="mt-4 border border-amber-200 p-0 overflow-hidden" id="missing-checkout">
      <div className="bg-amber-50 px-4 py-3">
        <p className="text-[0.6875rem] font-bold text-amber-700">조치 필요 · 오래된 순</p>
        <h2 className="mt-0.5 text-body font-extrabold text-ink">퇴근 기록이 없는 근무 {total}건</h2>
        <p className="mt-1 text-[0.75rem] leading-5 text-sub">퇴근 가능 시간이 지나 본인이 더 찍을 수 없어요. 퇴근시간을 넣어야 근무시간이 급여에 반영돼요.</p>
      </div>
      <ul className="divide-y divide-line">
        {items.map((row) => (
          <li key={`${row.kind}-${row.id}`}>
            <Link href={missingCheckoutHref(row)} className="flex min-h-[60px] items-center justify-between gap-3 px-4 py-2.5 active:bg-bg">
              <div className="min-w-0">
                <p className="text-body font-bold text-ink">
                  {row.name}
                  {row.kind === 'shift' && <span className="ml-1.5 rounded bg-bg px-1.5 py-0.5 text-[0.6875rem] font-bold text-sub">공고 근무</span>}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-sub">
                  {dateLabel(row.workDate)} · 출근 {timeLabel(row.checkInAt)}
                  {row.scheduledEnd ? ` · 예정 퇴근 ${row.scheduledEnd.slice(0, 5)}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-[0.75rem] font-bold text-primary">퇴근시간 입력 ›</span>
            </Link>
          </li>
        ))}
      </ul>
      {total > items.length && (
        <p className="border-t border-line px-4 py-2.5 text-[0.6875rem] text-sub">
          오래된 {Math.min(items.length, MISSING_CHECKOUT_LIST_LIMIT)}건만 보여요. 정리하면 다음 건이 올라와요.
        </p>
      )}
    </Card>
  );
}
