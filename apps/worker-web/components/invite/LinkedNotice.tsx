'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { InstallAppButton } from '@/components/InstallAppButton';
import { useDemoSession } from '@/lib/demo-session';
import { usePwaInstall } from '@/lib/pwa-install';
import { LINKED_INSTALL_KEY, LINKED_INSTALL_EVENT } from '@/lib/linked-install';

// 초대를 수락하면 완료 화면 없이 바로 근무 화면으로 온다 — 여기서 한 번만 '연결됐어요'를 알려 준다.
// JoinInvite 가 sessionStorage 에 남기고, 처음 보여 줄 때 지운다.
export const LINKED_NOTICE_KEY = 'atman_linked_notice';
type Notice = { facility: string; bank: 'shared' | 'missing' | null; bankLabel: string | null };

export function LinkedNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const demo = useDemoSession();
  const install = usePwaInstall();
  function dismiss() {
    setNotice(null);
    // Respect “later” across both the contextual card and the general banner.
    try { window.localStorage.setItem('installBannerDismissedAt', String(Date.now())); } catch { /* optional */ }
    try { window.sessionStorage.removeItem(LINKED_INSTALL_KEY); } catch { /* optional notice */ }
    window.dispatchEvent(new Event(LINKED_INSTALL_EVENT));
  }
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
    <section aria-label="근무지 연결 완료" className="mt-3 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p role="status" className="text-[13px] font-extrabold text-emerald-800">✓ 연결됐어요 · {notice.facility}</p>
        {notice.bank === 'shared' && <p className="mt-0.5 text-[12px] text-emerald-700">지급 계좌{notice.bankLabel ? ` ${notice.bankLabel}` : ''}도 전달했어요.</p>}
        {notice.bank === 'missing' && <Link href="/gig/settlement" className="mt-0.5 block text-[12px] font-bold text-amber-700">지급 계좌를 등록하면 지급이 늦어지지 않아요 →</Link>}
        {demo === false && install.ready && !install.installed && <div className="mt-3 border-t border-emerald-200 pt-3">
          <p className="text-[13px] font-bold text-ink">내 근무표를 홈 화면에서 바로 열어요</p>
          <p className="mt-1 mb-3 text-[12px] leading-5 text-sub">초대 수락은 완료됐어요. 잇닿 워커를 추가하면 내 근무와 출퇴근 화면을 편하게 다시 열 수 있어요. 설치하지 않아도 계속 이용할 수 있어요.</p>
          <InstallAppButton label="내 근무표를 홈 화면에 추가" />
          <button type="button" onClick={dismiss} className="mt-1 min-h-11 w-full text-[12px] font-bold text-sub">나중에 · 근무 화면 계속 보기</button>
        </div>}
      </div>
      <button type="button" onClick={dismiss} aria-label="안내 닫기" className="min-h-11 min-w-11 shrink-0 text-[14px] text-emerald-700/60">✕</button>
    </section>
  );
}
