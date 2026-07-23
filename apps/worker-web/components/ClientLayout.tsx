'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { WorkerNav } from './WorkerNav';
import { InstallBanner } from './InstallBanner';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();

  // PWA: 설치 가능하려면 SW가 앱 로드 시점에 등록돼 있어야 함 (푸시 구독 시점 X)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  const showNav = path.startsWith('/home') || path.startsWith('/shifts') || path.startsWith('/map') || path.startsWith('/applications')
    || (path.startsWith('/workplace') && !path.startsWith('/workplace/qr'))
    || path.startsWith('/earnings') || path.startsWith('/settings');
  return (
    <>
      <div className={showNav ? 'pb-[56px]' : ''}>{children}</div>
      {showNav && <InstallBanner />}
      {showNav && <WorkerNav />}
    </>
  );
}
