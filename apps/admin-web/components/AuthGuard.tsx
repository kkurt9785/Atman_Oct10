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
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
