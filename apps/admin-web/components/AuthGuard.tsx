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
  const [error,setError]=useState(false);
  const [retry,setRetry]=useState(0);

  useEffect(() => {
    let active = true;

    async function verify() {
      setError(false);
      try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !(await syncServerSession(session.access_token))) {
        if(window.location.pathname==='/notifications/open') {
          try {sessionStorage.setItem('itdot:pending-admin-notification',window.location.pathname+window.location.search);} catch {}
        }
        await fetch('/api/admin-session', { method: 'DELETE' }).catch(() => undefined);
        if (active) router.replace('/login');
        return;
      }
      if (active) {
        try {
          const pending=sessionStorage.getItem('itdot:pending-admin-notification');
          sessionStorage.removeItem('itdot:pending-admin-notification');
          if(pending?.startsWith('/notifications/open?')&&window.location.pathname!=='/notifications/open') {window.location.replace(pending);return;}
        } catch {}
        setReady(true);
      }
      } catch {if(active)setError(true);}
    }

    void verify();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        void fetch('/api/admin-session', { method: 'DELETE' });
        router.replace('/login');
        return;
      }
      void syncServerSession(session.access_token).catch(()=>{if(active)setError(true);});
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [router,retry]);

  if(error&&!ready)return <main className="mx-auto max-w-app px-5 py-10"><p role="alert" className="font-bold">로그인 상태를 확인하지 못했어요. 연결 상태를 확인해 주세요.</p><button onClick={()=>setRetry(value=>value+1)} className="mt-4 min-h-11 rounded-xl bg-primary px-4 font-bold text-white">다시 시도</button></main>;

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
