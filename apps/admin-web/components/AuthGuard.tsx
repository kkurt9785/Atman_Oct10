'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';

async function syncServerSession(accessToken: string): Promise<boolean> {
  const response = await fetch('/api/admin-session', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  return response.ok;
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    async function verify() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !(await syncServerSession(session.access_token))) {
        await fetch('/api/admin-session', { method: 'DELETE' }).catch(() => undefined);
        if (active) router.replace('/login');
        return;
      }
      if (active) setReady(true);
    }

    void verify();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        void fetch('/api/admin-session', { method: 'DELETE' });
        router.replace('/login');
        return;
      }
      void syncServerSession(session.access_token);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="mx-auto min-h-screen max-w-app bg-bg" aria-busy="true" aria-label="관리자 화면을 준비하는 중">
        <header className="flex h-14 items-center px-5">
          <span className="text-title font-extrabold text-primary">잇닿</span>
        </header>
        <main className="px-4 pb-24">
          <div className="mt-3 rounded-2xl bg-white p-5 shadow-sm">
            <div className="h-3 w-24 animate-pulse rounded-full bg-primary/10" />
            <div className="mt-3 h-7 w-44 animate-pulse rounded-xl bg-line" />
            <div className="mt-5 h-20 animate-pulse rounded-xl bg-bg" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-2xl bg-white shadow-sm" />
            ))}
          </div>
          <span className="sr-only">관리자 권한을 확인하고 있어요.</span>
        </main>
      </div>
    );
  }

  return <>{children}</>;
}
