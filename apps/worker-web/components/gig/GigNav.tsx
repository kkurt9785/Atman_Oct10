'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 긱워커 전용 하단 탭. 오늘 근무·관리자 대화·근태와 지급 세 가지만 둔다.
const TABS = [
  { href: '/gig', label: '오늘', icon: 'home' },
  { href: '/gig/workroom', label: '관리자 대화', icon: 'chat' },
  { href: '/gig/settlement', label: '근태·지급', icon: 'settlement' },
];

const ICONS = {
  home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  chat: <><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/></>,
  settlement: <><path d="M5 3h14v18H5z"/><path d="M8 7h8M8 11h8M8 15h4"/><path d="m14 16 1.5 1.5L19 14"/></>,
};

export function GigNav() {
  const path = usePathname();
  return (
    <nav aria-label="초대 근무 메뉴" className="fixed bottom-0 inset-x-0 z-30 mx-auto flex max-w-app border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
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
