'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 긱워커 전용 하단 탭. 의료 워커 탭(WorkerNav)과 완전히 분리 — 근무 찾기·지원·급여는 여기 없다.
const TABS = [
  { href: '/gig', label: '오늘 근무', icon: 'home' },
  { href: '/gig/workroom', label: '워크룸', icon: 'chat' },
  { href: '/gig/notifications', label: '알림', icon: 'notification' },
  { href: '/gig/settings', label: '내 정보', icon: 'profile' },
];

const ICONS = {
  home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  chat: <><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/></>,
  notification: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  profile: <><circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/></>,
};

export function GigNav() {
  const path = usePathname();
  return (
    <nav aria-label="긱워커 메뉴" className="fixed bottom-0 inset-x-0 z-30 mx-auto flex max-w-app border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      {TABS.map((tab) => {
        const active = tab.href === '/gig' ? path === '/gig' : path.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-3 ${active ? 'text-primary' : 'text-tertiary'}`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[tab.icon as keyof typeof ICONS]}</svg>
            <span className="text-[11px] font-semibold">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
