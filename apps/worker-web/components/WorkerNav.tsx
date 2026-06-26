'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/home',         label: '홈',     icon: '🏠' },
  { href: '/shifts',       label: '시프트', icon: '🏥' },
  { href: '/applications', label: '내 지원', icon: '📋' },
];

export function WorkerNav() {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white border-t border-line flex z-30">
      {TABS.map((t) => {
        const active = path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-3 min-h-[56px] ${
              active ? 'text-primary' : 'text-tertiary'
            }`}
          >
            <span className="text-2xl leading-none">{t.icon}</span>
            <span className="text-[11px] font-semibold">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
