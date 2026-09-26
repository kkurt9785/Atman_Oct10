'use client';

import { usePathname } from 'next/navigation';
import { GigNav } from '@/components/gig/GigNav';
import { InstallBanner } from '@/components/InstallBanner';
import { WorkerShellGuard } from '@/components/WorkerShellGuard';

// /gig 아래는 긱워커 전용 셸. ClientLayout 의 WorkerNav 는 /gig 경로를 모르므로 여기서만 GigNav 를 단다.
// /gig/join 은 초대 수락 화면이라 탭도 가드도 없다 — 초대가 어느 제품 것인지는 JoinInvite 가 서버 응답으로 정한다.
export default function GigLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const joining = path.startsWith('/gig/join');
  return (
    <>
      {!joining && <WorkerShellGuard shell="gig" />}
      <div className={joining ? '' : 'pb-[calc(56px+env(safe-area-inset-bottom))]'}>{children}</div>
      {!joining && <InstallBanner hint="홈 화면에서 바로 출퇴근을 기록하세요" />}
      {!joining && <GigNav />}
    </>
  );
}
