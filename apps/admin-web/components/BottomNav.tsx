'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { badgeText, NAV_BADGES_EVENT } from '@/lib/nav-badges';
import type { FacilityMode } from '@/lib/facility-mode';

// 하단 탭은 사업장 모드별로, 쓰는 순서대로 짠다(2026-11-12 탭 개편 — 당근처럼 대화를 탭으로, 만들기는 홈 버튼으로).
//   medical: 홈 · 근태 · 대화 · 직원 · 관리. 매일 보는 건 출근 확인·승인·직원 대화. 공고 모집은 홈의 [+ 근무자 모집]과 관리 > 공고 모집.
//   gig:     오늘 · 근무 · 대화 · 지급 · 관리. 행사 하나가 만들기 → 초대 → 당일 확인 → 지급으로 끝난다. 근무자 앱(오늘·사장님 대화·근태·지급)과 짝.
// 알림은 상단 종. 숫자는 /api/nav-badges(대화 = 안 읽은 근무자 메시지, 지급 = 지급할 사람 수).
type Tab = { href: string; icon: keyof typeof ICONS; label: string; badge?: 'chat' | 'pay'; match: (path: string) => boolean };
const MEDICAL_TABS: Tab[] = [
  { href: '/', icon: 'home', label: '홈', match: (p) => p === '/' },
  { href: '/timesheet', icon: 'clock', label: '근태', match: (p) => p.startsWith('/timesheet') || p.startsWith('/attendance-') || p.startsWith('/leave') },
  { href: '/workroom', icon: 'chat', label: '대화', badge: 'chat', match: (p) => p.startsWith('/workroom') || p.startsWith('/chats') },
  { href: '/staff', icon: 'staff', label: '직원', match: (p) => p.startsWith('/staff') },
  { href: '/more', icon: 'manage', label: '관리', match: (p) => ['/more', '/shifts', '/applications', '/operations', '/vacancy', '/payroll', '/workforce', '/membership', '/settings', '/sites', '/safety', '/notifications'].some((x) => p.startsWith(x)) },
];
const GIG_TABS: Tab[] = [
  { href: '/', icon: 'home', label: '오늘', match: (p) => p === '/' },
  { href: '/gig-work', icon: 'work', label: '근무', match: (p) => p.startsWith('/gig-work') || p.startsWith('/staff') },
  { href: '/workroom', icon: 'chat', label: '대화', badge: 'chat', match: (p) => p.startsWith('/workroom') },
  { href: '/gig-pay', icon: 'pay', label: '지급', badge: 'pay', match: (p) => p.startsWith('/gig-pay') },
  { href: '/more', icon: 'manage', label: '관리', match: (p) => ['/more', '/timesheet', '/attendance-', '/membership', '/settings', '/sites', '/safety', '/notifications'].some((x) => p.startsWith(x)) },
];

const ICONS={
  home:<><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  recruit:<><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4h8v2M8 12h8M12 9v6"/></>,
  staff:<><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 8h5M18.5 5.5v5"/></>,
  chat:<><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  work:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3"/></>,
  pay:<><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/><circle cx="16.5" cy="14.5" r="1.5"/></>,
  manage:<><path d="M4 20V8l8-4 8 4v12"/><path d="M8 20v-7h8v7M9 9h.01M12 9h.01M15 9h.01"/></>,
};

export function BottomNav({ mode, canPay = true }: { mode: FacilityMode | null; canPay?: boolean }) {
  const path = usePathname();
  const tabs = (mode === 'gig' ? GIG_TABS : MEDICAL_TABS).filter((t) => t.href !== '/gig-pay' || canPay);
  const [badges, setBadges] = useState<{ chat: number; pay: number }>({ chat: 0, pay: 0 });
  // 화면을 옮길 때와 앱으로 돌아올 때 숫자를 다시 받는다. 실패하면 숫자만 안 보인다.
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/nav-badges', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive && data) setBadges({ chat: Number(data.chat) || 0, pay: Number(data.pay) || 0 }); })
      .catch(() => undefined);
    load();
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    // 대화를 읽으면 화면을 옮기지 않아도 숫자가 줄어야 한다(대화 화면이 신호를 보낸다)
    window.addEventListener(NAV_BADGES_EVENT, load);
    return () => { alive = false; document.removeEventListener('visibilitychange', onFocus); window.removeEventListener(NAV_BADGES_EVENT, load); };
  }, [path]);
  return (
    <nav aria-label="주요 메뉴" className={`fixed bottom-0 inset-x-0 z-30 mx-auto bg-white border-t border-line flex pb-[env(safe-area-inset-bottom)] ${mode==='gig'?'max-w-5xl':'max-w-app'}`}>
      {tabs.map((t) => {
        const active = t.match(path);
        const count = t.badge ? badgeText(badges[t.badge]) : '';
        return (
          <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined} aria-label={count ? `${t.label} ${count}${t.badge === 'pay' ? '명' : '건'}` : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-1 min-w-0 min-h-[var(--bottom-nav-height)] py-2 ${active ? 'text-primary' : 'text-sub'}`}>
            <span className={`relative flex h-6 w-12 items-center justify-center rounded-full ${active ? 'bg-primary/10' : ''}`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[t.icon]}</svg>
              {count && <span aria-hidden="true" className={`absolute -top-1.5 right-0.5 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 text-[0.625rem] font-extrabold leading-none text-white ${t.badge === 'pay' ? 'bg-amber-500' : 'bg-red-500'}`}>{count}</span>}
            </span>
            <span className="text-[0.75rem] leading-4 font-semibold whitespace-nowrap">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
