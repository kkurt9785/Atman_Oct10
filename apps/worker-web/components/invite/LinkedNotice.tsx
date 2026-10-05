'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// 초대를 수락하면 완료 화면 없이 바로 근무 화면으로 온다 — 여기서 한 번만 '연결됐어요'를 알려 준다.
// JoinInvite 가 sessionStorage 에 남기고, 처음 보여 줄 때 지운다.
export const LINKED_NOTICE_KEY = 'atman_linked_notice';
type Notice = { facility: string; bank: 'shared' | 'missing' | null; bankLabel: string | null };

export function LinkedNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(LINKED_NOTICE_KEY);
      if (!raw) return;
      window.sessionStorage.removeItem(LINKED_NOTICE_KEY);
      setNotice(JSON.parse(raw) as Notice);
    } catch { /* 저장소를 못 읽으면 안내 없이 진행 */ }
  }, []);
  if (!notice) return null;
  return (
    <div role="status" className="mt-3 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-extrabold text-emerald-800">✓ 연결됐어요 · {notice.facility}</p>
        {notice.bank === 'shared' && <p className="mt-0.5 text-[12px] text-emerald-700">지급 계좌{notice.bankLabel ? ` ${notice.bankLabel}` : ''}도 전달했어요.</p>}
        {notice.bank === 'missing' && <Link href="/gig/settlement" className="mt-0.5 block text-[12px] font-bold text-amber-700">지급 계좌를 등록하면 지급이 늦어지지 않아요 →</Link>}
      </div>
      <button type="button" onClick={() => setNotice(null)} aria-label="안내 닫기" className="shrink-0 px-1 text-[14px] text-emerald-700/60">✕</button>
    </div>
  );
}
