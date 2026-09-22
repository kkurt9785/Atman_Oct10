'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  getFacilityRegistrationSources,
  getGigworkerModePreference,
  shouldUseGigworkerMode,
  WORKER_MODE_CHANGED_EVENT,
} from '@/lib/worker-mode';

const MARKET_TABS = [
  { href: '/home',         label: '홈',     icon: 'home' },
  { href: '/shifts',       label: '근무 찾기', icon: 'search' },
  { href: '/applications', label: '지원 현황', icon: 'applications' },
  { href: '/earnings',     label: '급여',   icon: 'pay' },
  { href: '/settings',     label: '내 정보', icon: 'profile' },
  { href: '/notifications', label: '알림', icon: 'notification' },
];

const GIGWORKER_TABS = [
  { href: '/workplace', label: '오늘 근무', icon: 'home' },
  { href: '/notifications', label: '알림', icon: 'notification' },
  { href: '/settings', label: '내 정보', icon: 'profile' },
];

const ICONS={
  home:<><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  search:<><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5M7 10h6M10 7v6"/></>,
  applications:<><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/></>,
  pay:<><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M12 7v8"/></>,
  profile:<><circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/></>,
  notification:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
};

export function WorkerNav() {
  const path = usePathname();
  const [gigworker, setGigworker] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const cached = getGigworkerModePreference();
      if (cached && active) setGigworker(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data }, { data: worker }] = await Promise.all([
        supabase.from('facility_staff').select('facilities(registration_source)').neq('status', 'ended'),
        supabase.from('workers').select('role').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
      ]);
      if (!active) return;
      const sources = getFacilityRegistrationSources(data);
      const gigworkerMode = shouldUseGigworkerMode(sources, worker?.role, getGigworkerModePreference());
      setGigworker(gigworkerMode);
    };
    void load();
    window.addEventListener('atman:workplace-linked', load);
    window.addEventListener(WORKER_MODE_CHANGED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener('atman:workplace-linked', load);
      window.removeEventListener(WORKER_MODE_CHANGED_EVENT, load);
    };
  }, [path]);

  const tabs = gigworker ? GIGWORKER_TABS : MARKET_TABS;
  return (
    <nav aria-label="주요 메뉴" className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white border-t border-line flex z-30 pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => {
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
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[t.icon as keyof typeof ICONS]}</svg>
            <span className="text-[11px] font-semibold">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
