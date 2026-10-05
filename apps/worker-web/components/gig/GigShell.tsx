'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { InstallBanner } from '@/components/InstallBanner';
import { WorkerShellGuard } from '@/components/WorkerShellGuard';
import { supabase } from '@/lib/supabase';
import { getSignedInUser } from '@/lib/auth-user';
import { useDemoSession } from '@/lib/demo-session';
import { GigNav } from './GigNav';

// /gig 아래의 간편 내비게이션·가드. 설치 앱은 루트 셸과 같은 '잇닿 워커'를 쓴다.
export function GigShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const bare = path.startsWith('/gig/join') || path.startsWith('/gig/demo');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const demo = useDemoSession();

  useEffect(() => {
    let active = true;
    void getSignedInUser().then((user) => { if (active) setSignedIn(Boolean(user)); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session?.user)));
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const showShell = !bare && signedIn === true;
  return (
    <>
      {!bare && <WorkerShellGuard shell="gig" />}
      <div className={showShell ? 'pb-[calc(56px+env(safe-area-inset-bottom))]' : ''}>{children}</div>
      {showShell && !demo && <InstallBanner hint="잇닿 워커를 홈 화면에 두고 바로 출퇴근하세요" />}
      {showShell && <GigNav />}
    </>
  );
}
