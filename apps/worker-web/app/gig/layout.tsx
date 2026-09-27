'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { GigNav } from '@/components/gig/GigNav';
import { InstallBanner } from '@/components/InstallBanner';
import { WorkerShellGuard } from '@/components/WorkerShellGuard';
import { supabase } from '@/lib/supabase';

// /gig 아래는 긱워커 전용 셸. ClientLayout 의 WorkerNav 는 /gig 경로를 모르므로 여기서만 GigNav 를 단다.
// /gig/join 은 초대 수락, /gig/demo 는 시연 입구라 탭도 가드도 없다. /gig 자체는 로그인 전이면 긱워커 랜딩이라 탭을 숨긴다.
// 홈 화면에 설치하면 '잇닿 GIG' 라는 별도 앱으로 잡히도록 이 셸에서는 매니페스트·아이콘·테마색을 긱워커 것으로 바꾼다.
export default function GigLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const bare = path.startsWith('/gig/join') || path.startsWith('/gig/demo');
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => { if (active) setSignedIn(Boolean(data.user)); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session?.user)));
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const touchIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const previous = { manifest: manifest?.href, touchIcon: touchIcon?.href, theme: theme?.content, title: title?.content };
    if (manifest) manifest.href = '/gig-manifest.json';
    if (touchIcon) touchIcon.href = '/gig-icon-180.png';
    if (theme) theme.content = '#191F28';
    if (title) title.content = '잇닿 GIG';
    return () => {
      if (manifest && previous.manifest) manifest.href = previous.manifest;
      if (touchIcon && previous.touchIcon) touchIcon.href = previous.touchIcon;
      if (theme && previous.theme) theme.content = previous.theme;
      if (title && previous.title) title.content = previous.title;
    };
  }, []);

  const showShell = !bare && signedIn === true;
  return (
    <>
      {!bare && <WorkerShellGuard shell="gig" />}
      <div className={showShell ? 'pb-[calc(56px+env(safe-area-inset-bottom))]' : ''}>{children}</div>
      {showShell && <InstallBanner hint="잇닿 GIG를 홈 화면에 두고 바로 출퇴근하세요" />}
      {showShell && <GigNav />}
    </>
  );
}
