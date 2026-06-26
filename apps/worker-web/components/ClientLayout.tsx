'use client';

import { usePathname } from 'next/navigation';
import { WorkerNav } from './WorkerNav';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const showNav = path.startsWith('/home') || path.startsWith('/shifts') || path.startsWith('/applications');
  return (
    <>
      <div className={showNav ? 'pb-[56px]' : ''}>{children}</div>
      {showNav && <WorkerNav />}
    </>
  );
}
