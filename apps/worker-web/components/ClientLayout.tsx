'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { WorkerNav } from './WorkerNav';
import { InstallBanner } from './InstallBanner';
import { WorkerShellGuard } from './WorkerShellGuard';
import { isMedicalShellPath } from '@/lib/worker-mode';

// 의료 워커 셸의 하단 탭이 붙는 경로. /gig 아래는 app/gig/layout.tsx 가 긱워커 셸(GigNav)을 따로 단다.
const NAV_PREFIXES = ['/home', '/shifts', '/map', '/applications', '/workplace', '/workroom', '/earnings', '/rewards', '/settings', '/notifications'];

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();

  // PWA: 설치 가능하려면 SW가 앱 로드 시점에 등록돼 있어야 함 (푸시 구독 시점 X)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  const showNav = NAV_PREFIXES.some((prefix) => path.startsWith(prefix))
    && !path.startsWith('/workplace/qr') && !path.startsWith('/workplace/join');
  const guardMedical = isMedicalShellPath(path);
  return (
    <>
      {guardMedical && <WorkerShellGuard shell="medical" />}
      <div className={showNav ? 'pb-[calc(56px+env(safe-area-inset-bottom))]' : ''}>{children}</div>
      {showNav && <InstallBanner />}
      {showNav && <WorkerNav />}
    </>
  );
}
