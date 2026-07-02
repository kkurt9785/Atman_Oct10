'use client';
import { usePathname, useRouter } from 'next/navigation';
import { AuthGuard } from './AuthGuard';
import { TextSizeToggle } from './TextSizeToggle';
import { BottomNav } from './BottomNav';
import { FacilitySwitcher } from './FacilitySwitcher';
import { supabase } from '@/lib/supabase-browser';

const PUBLIC_PREFIX = ['/login', '/auth/', '/setup/'];
const FULLSCREEN_PREFIX = ['/checkin'];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/login');
  }
  const isPublic = PUBLIC_PREFIX.some((p) => pathname.startsWith(p));

  const isFullscreen = FULLSCREEN_PREFIX.some((p) => pathname.startsWith(p));

  if (isPublic) {
    return (
      <div className="mx-auto max-w-app min-h-screen bg-bg">
        {children}
      </div>
    );
  }

  if (isFullscreen) {
    return <AuthGuard>{children}</AuthGuard>;
  }

  return (
    <AuthGuard>
      <div className="mx-auto max-w-app min-h-screen bg-bg pb-24">
        <header className="sticky top-0 z-10 flex items-center justify-between px-5 h-14 bg-bg/90 backdrop-blur">
          <span className="text-title font-extrabold text-primary">잇닿</span>
          <div className="flex items-center gap-2">
            <FacilitySwitcher />
            <TextSizeToggle />
            <button
              onClick={handleLogout}
              className="text-[13px] text-sub px-2 py-1 rounded-lg hover:bg-surface"
            >
              로그아웃
            </button>
          </div>
        </header>
        {children}
        <BottomNav />
      </div>
    </AuthGuard>
  );
}
