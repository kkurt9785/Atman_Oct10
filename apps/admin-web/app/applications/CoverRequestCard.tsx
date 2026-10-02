'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { approveCover, rejectCoverClaim } from './actions';
import type { CoverRequestRow } from '@/lib/db/cover';

const ROLE_LABEL: Record<string, string> = { rn: '간호사', na: '간호조무사', pharmacist: '약사', pharmacy_staff: '약국 전산·사무직' };
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

function whenLabel(row: CoverRequestRow) {
  const weekday = WEEKDAY[new Date(`${row.shiftDate}T12:00:00+09:00`).getUTCDay()];
  const date = `${Number(row.shiftDate.slice(5, 7))}월 ${Number(row.shiftDate.slice(8, 10))}일(${weekday})`;
  return `${date} ${row.startTime.slice(0, 5)}~${row.endTime.slice(0, 5)}${row.isOvernight ? ' 익일' : ''}`;
}

export function CoverRequestCard({ row }: { row: CoverRequestRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState('');
  const claimed = row.status === 'claimed';

  async function run(kind: 'approve' | 'reject') {
    setBusy(kind);
    setError('');
    const result = kind === 'approve' ? await approveCover(row.id) : await rejectCoverClaim(row.id);
    setBusy(null);
    if (!result.ok) { setError(result.message); return; }
    router.refresh();
  }

  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm ${claimed ? 'border-primary/30' : 'border-line'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[0.75rem] font-extrabold ${claimed ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-800'}`}>
          {claimed ? '승인 필요' : '대타 구하는 중'}
        </span>
        <span className="text-[0.75rem] text-sub">{row.department ?? ''}</span>
      </div>
      <p className="mt-2 text-label font-bold text-sub">{whenLabel(row)}</p>
      <p className="mt-1 text-title font-extrabold text-ink">
        {claimed ? <>{row.requesterName} <span className="text-sub" aria-label="에서">→</span> {row.claimerName}</> : `${row.requesterName}님 근무`}
      </p>
      {claimed && row.claimerRole && <p className="mt-0.5 text-[0.8125rem] text-sub">{ROLE_LABEL[row.claimerRole] ?? row.claimerRole} · 이 사업장에서 함께 일한 인력</p>}
      {row.reason && <p className="mt-3 rounded-xl bg-bg px-3 py-2 text-[0.8125rem] text-ink"><b className="text-sub">사유</b> {row.reason}</p>}

      {claimed ? (
        <>
          <p className="mt-3 text-[0.8125rem] leading-5 text-sub">
            확정하면 <b className="text-ink">{row.claimerName}님</b>이 이 근무를 맡고, {row.requesterName}님은 빠져요. 이전에 이 사업장에서 확인한 자격 기록을 그대로 이어받아요.
          </p>
          {error && <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[0.8125rem] font-bold text-red-700">{error}</p>}
          <div className="mt-3 grid grid-cols-[1fr_1.4fr] gap-2">
            <button type="button" disabled={busy !== null} onClick={() => run('reject')} className="min-h-12 rounded-xl border border-line text-label font-bold text-sub disabled:opacity-50">
              {busy === 'reject' ? '처리 중…' : '다른 분 기다리기'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => run('approve')} className="min-h-12 rounded-xl bg-primary text-label font-extrabold text-white disabled:opacity-50">
              {busy === 'approve' ? '확정 중…' : `${row.claimerName}님으로 확정`}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-3 text-[0.8125rem] leading-5 text-sub">
          아직 맡은 사람이 없어요. <b className="text-ink">그 전까지는 {row.requesterName}님 근무</b>예요. 급하면{' '}
          <Link href="/shifts/new" className="font-bold text-primary underline">공고를 따로 올릴 수 있어요</Link>.
        </p>
      )}
    </article>
  );
}
