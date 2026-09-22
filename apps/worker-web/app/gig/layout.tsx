'use client';

import { usePathname } from 'next/navigation';
import { GigNav } from '@/components/gig/GigNav';
import { InstallBanner } from '@/components/InstallBanner';

// /gig 아래는 긱워커 전용 셸. ClientLayout 의 WorkerNav 는 /gig 경로를 모르므로 여기서만 GigNav 를 단다.
export default function GigLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const showNav = !path.startsWith('/gig/join');
  return (
    <>
      <div className={showNav ? 'pb-[calc(56px+env(safe-area-inset-bottom))]' : ''}>{children}</div>
      {showNav && <InstallBanner />}
      {showNav && <GigNav />}
    </>
  );
}
