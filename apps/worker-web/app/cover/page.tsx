'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { claimCover, listClaimableCovers, type ClaimableCover } from '@/lib/cover';

// 대타 구하는 근무 — 이 사업장에서 함께 일한 같은 직군에게만 보인다.
// 요청자 이름과 사유는 보여주지 않는다(병가 같은 사적인 사유 보호). 사업장이 승인해야 확정된다.

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

// KST 정오(=UTC 03시)는 항상 같은 날짜라 요일이 어긋나지 않는다
function dayLabel(date: string) {
  const weekday = WEEKDAY[new Date(`${date}T12:00:00+09:00`).getUTCDay()];
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 (${weekday})`;
}

function timeRange(cover: ClaimableCover) {
  return `${cover.start_time.slice(0, 5)}~${cover.end_time.slice(0, 5)}${cover.is_overnight ? ' (다음날)' : ''}`;
}

function CoverCard({ cover, onClaimed }: { cover: ClaimableCover; onClaimed: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function claim() {
    setBusy(true);
    setError('');
    const result = await claimCover(cover.id);
    setBusy(false);
    if (!result.ok) { setError(result.message); setConfirming(false); return; }
    await onClaimed();
  }

  return (
    <div className="mb-3 rounded-card bg-white p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-sub">{dayLabel(cover.shift_date)}</span>
        <span className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${cover.claimed_by_me ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-800'}`}>
          {cover.claimed_by_me ? '승인 대기' : '대타 구함'}
        </span>
      </div>
      <p className="mt-2 truncate text-[15px] font-extrabold text-ink">{cover.facility_name}</p>
      <p className="mt-1 text-[20px] font-extrabold leading-tight text-ink">{timeRange(cover)}</p>
      {cover.department && <p className="mt-0.5 text-[13px] text-tertiary">{cover.department}</p>}
      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <div>
          <p className="text-[12px] text-tertiary">예상 지급액</p>
          <p className="text-[17px] font-extrabold text-ink">₩{cover.estimated_total_pay.toLocaleString('ko-KR')}</p>
        </div>
        <p className="text-[12px] text-tertiary">시급 {cover.hourly_wage.toLocaleString('ko-KR')}원</p>
      </div>

      {error && <p role="alert" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-800">{error}</p>}

      {cover.claimed_by_me ? (
        <p className="mt-3 rounded-xl bg-primary/5 px-3 py-2.5 text-[13px] leading-5 text-sub">
          맡겠다고 전했어요. <b className="text-ink">사업장이 승인하면 확정 알림</b>이 와요.
        </p>
      ) : confirming ? (
        <div className="mt-3 rounded-xl border border-line bg-bg p-3">
          <p className="text-[13px] font-extrabold text-ink">사업장이 승인하면 확정돼요</p>
          <p className="mt-1 text-[12px] leading-5 text-sub">확정된 뒤에는 이 근무에 꼭 나가야 해요. 같은 시간에 다른 근무가 없는지 확인해 주세요.</p>
          <div className="mt-2 grid grid-cols-[1fr_2fr] gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="h-11 rounded-btn border border-line bg-white text-[13px] font-bold text-sub">다시 볼게요</button>
            <button type="button" disabled={busy} onClick={claim} className="h-11 rounded-btn bg-primary text-[13px] font-extrabold text-white disabled:opacity-50">
              {busy ? '전하는 중…' : '네, 맡을게요'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-3 h-12 w-full rounded-btn bg-primary text-[14px] font-extrabold text-white active:opacity-80">
          제가 갈게요
        </button>
      )}
    </div>
  );
}

export default function CoverPage() {
  const router = useRouter();
  const [covers, setCovers] = useState<ClaimableCover[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setCovers(await listClaimableCovers());
  }, []);

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.localStorage.setItem('atman_auth_next', '/cover');
        router.replace('/onboarding');
        return;
      }
      await reload();
      setLoading(false);
    })();
  }, [router, reload]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-[15px] text-sub">불러오는 중...</p></div>;
  }

  return (
    <div className="px-4 pb-24">
      <div className="pb-4 pt-14">
        <Link href="/home" className="text-[13px] font-bold text-sub">← 홈</Link>
        <h1 className="mt-3 text-[28px] font-extrabold text-ink">대타 구하는 근무</h1>
        <p className="mt-1 text-[14px] leading-5 text-sub">함께 일한 사업장에서 나온 요청이에요. 같은 직군에게만 보여요.</p>
      </div>

      {covers.length === 0 ? (
        <div className="rounded-2xl bg-white px-4 py-12 text-center">
          <p className="text-[16px] font-bold text-ink">지금 대타를 구하는 근무가 없어요</p>
          <p className="mt-1 text-[13px] text-sub">함께 일한 사업장에서 대타를 구하면 알림으로 알려드려요.</p>
          <Link href="/home" className="mt-4 inline-flex h-10 items-center rounded-xl bg-bg px-4 text-[13px] font-bold text-ink">이번 주 근무 보기</Link>
        </div>
      ) : (
        covers.map((cover) => <CoverCard key={cover.id} cover={cover} onClaimed={reload} />)
      )}
    </div>
  );
}
