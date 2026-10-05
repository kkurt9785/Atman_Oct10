'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { WorkerNav } from './WorkerNav';
import { InstallBanner } from './InstallBanner';
import { WorkerShellGuard } from './WorkerShellGuard';
import { isMedicalShellPath } from '@/lib/worker-mode';
import { trackPath } from '@/lib/nav-history';
import { useDemoSession } from '@/lib/demo-session';
import { DemoBar } from './DemoBar';

// 시연 띠를 숨기는 경로 — 시연 입구 자체이거나, 화면 아래에 고정 버튼·카드가 있어 띠가 가리는 곳
const DEMO_BAR_HIDDEN = ['/demo', '/gig/demo', '/map', '/store', '/earnings', '/jobs', '/chat', '/onboarding', '/auth'];

// 의료 워커 셸의 하단 탭이 붙는 경로. /gig 아래는 app/gig/layout.tsx 가 긱워커 셸(GigNav)을 따로 단다.
const NAV_PREFIXES = ['/home', '/shifts', '/map', '/applications', '/cover', '/workplace', '/workroom', '/earnings', '/store', '/rewards', '/settings', '/notifications'];

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();

  // PWA: 설치 가능하려면 SW가 앱 로드 시점에 등록돼 있어야 함 (푸시 구독 시점 X)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  useEffect(() => { trackPath(path); }, [path]);
  const showNav = NAV_PREFIXES.some((prefix) => path.startsWith(prefix))
    && !path.startsWith('/workplace/qr') && !path.startsWith('/workplace/join');
  const guardMedical = isMedicalShellPath(path);
  const demo = useDemoSession();
  const gigNav = path.startsWith('/gig') && !path.startsWith('/gig/join') && !path.startsWith('/gig/demo');
  const showDemoBar = demo && !DEMO_BAR_HIDDEN.some((prefix) => path.startsWith(prefix));
  return (
    <>
      {guardMedical && <WorkerShellGuard shell="medical" />}
      <div className={showNav ? 'pb-[calc(56px+env(safe-area-inset-bottom))]' : ''}>
        {children}
        {showDemoBar && <div aria-hidden="true" className="h-20" />}
      </div>
      {showNav && !demo && <InstallBanner />}
      {showDemoBar && <DemoBar aboveNav={showNav || gigNav} />}
      {showNav && <WorkerNav />}
    </>
  );
}
