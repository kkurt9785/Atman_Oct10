'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { FacilityMode } from '@/lib/facility-mode';

// 하단 탭은 사업장 모드별로 다르다. 모드는 서버 레이아웃이 계산해 내려주므로 여기서 다시 조회하지 않는다.
//   medical: 홈 · 모집 · 근태 · 직원 · 관리. 알림은 상단으로 옮겨 모바일 탭을 다섯 개로 유지한다.
//   gig:     운영 · 근무자 · 대화 · 관리. 알림은 상단으로 옮겨 현장 모바일 탭을 네 개로 유지한다.
const MEDICAL_TABS = [
  { href: '/', icon: 'home', label: '홈' },
  { href: '/shifts', icon: 'recruit', label: '모집' },
  { href: '/timesheet', icon: 'clock', label: '근태' },
  { href: '/staff', icon: 'staff', label: '직원' },
  { href: '/more', icon: 'manage', label: '관리' },
];
const GIG_TABS = [
  { href: '/', icon: 'home', label: '운영' },
  { href: '/staff?view=contract&entry=gigworker', icon: 'staff', label: '근무자' },
  { href: '/workroom', icon: 'chat', label: '대화' },
  { href: '/more', icon: 'manage', label: '관리' },
];

const ICONS={
  home:<><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
  recruit:<><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4h8v2M8 12h8M12 9v6"/></>,
  staff:<><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 8h5M18.5 5.5v5"/></>,
  chat:<><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 9h8M8 12h5"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  manage:<><path d="M4 20V8l8-4 8 4v12"/><path d="M8 20v-7h8v7M9 9h.01M12 9h.01M15 9h.01"/></>,
};

function isActive(path:string,href:string,mode:FacilityMode|null){
  href=href.split('?')[0];
  if(href==='/')return path==='/'||(mode==='gig'&&path.startsWith('/gig-work'));
  if(href==='/shifts')return path.startsWith('/shifts')||path.startsWith('/applications')||path.startsWith('/chats');
  if(href==='/timesheet')return path.startsWith('/timesheet')||path.startsWith('/attendance-')||path.startsWith('/leave');
  if(href==='/more')return path.startsWith('/more')||path.startsWith('/operations')||path.startsWith('/payroll')||path.startsWith('/gig-pay')||path.startsWith('/workforce')||path.startsWith('/membership')||path.startsWith('/settings')||(mode==='gig'&&(path.startsWith('/timesheet')||path.startsWith('/attendance-')));
  return path.startsWith(href);
}

export function BottomNav({ mode }: { mode: FacilityMode | null }) {
  const path = usePathname();
  const tabs=mode==='gig'?GIG_TABS:MEDICAL_TABS;
  return (
    <nav aria-label="주요 메뉴" className={`fixed bottom-0 inset-x-0 z-30 mx-auto bg-white border-t border-line flex pb-[env(safe-area-inset-bottom)] ${mode==='gig'?'max-w-5xl':'max-w-app'}`}>
      {tabs.map((t) => {
        const active = isActive(path,t.href,mode);
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
