'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AuthGuard } from './AuthGuard';
import { TextSizeToggle } from './TextSizeToggle';
import { BottomNav } from './BottomNav';
import { FacilitySwitcher } from './FacilitySwitcher';
import { FacilityModeGuard } from './FacilityModeGuard';
import { supabase } from '@/lib/supabase-browser';
import type { FacilityMode } from '@/lib/facility-mode';

const PUBLIC_PREFIX = ['/login', '/auth/', '/setup/'];
const FULLSCREEN_PREFIX = ['/checkin', '/chats/'];

// facilityMode: 현재 사업장이 병원·약국(medical)인지 긱워커 근무지(gig)인지. 서버 레이아웃이 계산한다.
// 사업장 전환기가 router.refresh() 를 부르면 레이아웃이 다시 렌더되어 탭·가드가 함께 바뀐다.
export function Shell({ children, facilityMode }: { children: React.ReactNode; facilityMode: FacilityMode | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
  const isFullscreen = FULLSCREEN_PREFIX.some((p) => pathname.startsWith(p));

  // PWA: 설치 가능 조건 충족을 위해 앱 로드 시 SW 등록
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  async function handleLogout() {
    await fetch('/api/admin-session', { method: 'DELETE' }).catch(() => undefined);
    await supabase.auth.signOut();
    router.replace('/login');
  }
  if (isPublic) {
    return (
      <div className="mx-auto max-w-app min-h-screen bg-bg">
        {children}
      </div>
    );
  }

  if (isFullscreen) {
    return <AuthGuard><FacilityModeGuard mode={facilityMode} />{children}</AuthGuard>;
  }

  return (
    <AuthGuard>
      <FacilityModeGuard mode={facilityMode} />
      <div className="mx-auto max-w-app min-h-screen bg-bg pb-24">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-2 bg-bg/90 px-4 backdrop-blur">
          <span className="shrink-0 whitespace-nowrap text-[18px] font-extrabold text-primary">잇닿</span>
          <FacilitySwitcher />
          <TextSizeToggle />
          <button
            onClick={handleLogout}
            aria-label="로그아웃"
            title="로그아웃"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-sub active:bg-surface"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
              <path d="m15 8 4 4-4 4M9 12h10" />
            </svg>
          </button>
        </header>
        {children}
        <BottomNav mode={facilityMode} />
      </div>
    </AuthGuard>
  );
}
