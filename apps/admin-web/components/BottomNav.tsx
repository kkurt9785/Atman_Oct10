'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', icon: '🏠', label: '홈' },
  { href: '/shifts', icon: '📋', label: '공고' },
  { href: '/applications', icon: '👥', label: '지원자' },
  { href: '/staff', icon: '🧑‍⚕️', label: '직원' },
  { href: '/timesheet', icon: '🕐', label: '근태' },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="주요 메뉴" className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white border-t border-line flex">
      {TABS.map((t) => {
        const active = t.href === '/' ? path === '/' : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-tap py-2 ${active ? 'text-primary' : 'text-sub'}`}>
            <span aria-hidden="true" className="text-2xl leading-none">{t.icon}</span>
            <span className="text-label font-semibold">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
