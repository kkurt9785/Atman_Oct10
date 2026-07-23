'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/home',         label: '홈',     icon: '🏠' },
  { href: '/shifts',       label: '시프트', icon: '🏥' },
  { href: '/applications', label: '내 활동', icon: '📋' },
  { href: '/earnings',     label: '급여',   icon: '₩' },
  { href: '/settings',     label: '내 정보', icon: '👤' },
];

export function WorkerNav() {
  const path = usePathname();
  return (
    <nav aria-label="주요 메뉴" className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white border-t border-line flex z-30 pb-[env(safe-area-inset-bottom)]">
      {TABS.map((t) => {
        const active = path.startsWith(t.href) || (t.href === '/shifts' && path.startsWith('/map'));
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-3 min-h-[56px] ${
              active ? 'text-primary' : 'text-tertiary'
            }`}
          >
            <span aria-hidden="true" className="text-2xl leading-none">{t.icon}</span>
            <span className="text-[11px] font-semibold">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
