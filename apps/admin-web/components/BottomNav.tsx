'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', icon: 'home', label: '홈' },
  { href: '/shifts', icon: 'recruit', label: '모집' },
  { href: '/applications', icon: 'applications', label: '지원' },
  { href: '/staff', icon: 'staff', label: '직원' },
  { href: '/timesheet', icon: 'clock', label: '근태' },
];

const ICONS={
  home:<><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  recruit:<><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4h8v2M8 12h8M12 9v6"/></>,
  applications:<><circle cx="8" cy="8" r="3"/><path d="M3 20a5 5 0 0 1 10 0M16 7h5M16 11h5M16 15h4"/></>,
  staff:<><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 8h5M18.5 5.5v5"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
};

export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="주요 메뉴" className="fixed bottom-0 inset-x-0 z-30 mx-auto max-w-app bg-white border-t border-line flex pb-[env(safe-area-inset-bottom)]">
      {TABS.map((t) => {
        const active = t.href === '/' ? path === '/' : path.startsWith(t.href) || (t.href==='/timesheet'&&(path.startsWith('/attendance-history')||path.startsWith('/attendance-summary')));
        return (
          <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-tap py-2 ${active ? 'text-primary' : 'text-sub'}`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[t.icon as keyof typeof ICONS]}</svg>
            <span className="text-label font-semibold">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
