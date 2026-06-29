'use client';
import { usePathname } from 'next/navigation';
import { AuthGuard } from './AuthGuard';
import { TextSizeToggle } from './TextSizeToggle';
import { BottomNav } from './BottomNav';

const PUBLIC_PREFIX = ['/login', '/auth/'];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_PREFIX.some((p) => pathname.startsWith(p));

  if (isPublic) {
    return (
      <div className="mx-auto max-w-app min-h-screen bg-bg">
        {children}
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="mx-auto max-w-app min-h-screen bg-bg pb-24">
        <header className="sticky top-0 z-10 flex items-center justify-between px-5 h-14 bg-bg/90 backdrop-blur">
          <span className="text-title font-extrabold text-primary">잇닿</span>
          <TextSizeToggle />
        </header>
        {children}
        <BottomNav />
      </div>
    </AuthGuard>
  );
}
