'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-browser';

// 시연 중에는 어느 화면에서든 바로 가입하거나 처음 화면(로그인)으로 — 하단 탭 위에 띄운다.
// 시연 계정(@demo.atman.co.kr)은 영업 시연과 방문자가 같이 쓴다. 나갈 때는 서버 세션까지 지운다.
export function AdminDemoBar() {
  const [demo, setDemo] = useState(false);
  const [leaving, setLeaving] = useState<'signup' | 'start' | null>(null);
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setDemo((data.session?.user.email ?? '').toLowerCase().endsWith('@demo.atman.co.kr'));
    });
    return () => { active = false; };
  }, []);
  if (!demo) return null;

  async function leave(next: 'signup' | 'start') {
    setLeaving(next);
    await fetch('/api/admin-session', { method: 'DELETE' }).catch(() => undefined);
    await supabase.auth.signOut().catch(() => undefined);
    // 가입은 로그인 화면이 ?start=1 을 받아 바로 카카오 로그인으로 잇는다(카카오톡 안이면 바깥 브라우저로)
    window.location.replace(next === 'signup' ? '/login?start=1' : '/login');
  }

  return (
    <>
      <div aria-hidden="true" className="h-16" />
      <div role="region" aria-label="시연 안내"
        className="fixed inset-x-3 bottom-[calc(72px+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-[30rem] items-center gap-2 rounded-2xl bg-ink px-3 py-2.5 text-white shadow-lg">
        <span className="min-w-0 flex-1 leading-4">
          <span className="block text-[0.6875rem] font-bold text-white/60">지금은 시연 화면이에요</span>
          <button type="button" disabled={Boolean(leaving)} onClick={() => void leave('start')}
            className="-my-1 inline-flex min-h-[32px] items-center text-[0.8125rem] font-extrabold text-white underline decoration-white/40 underline-offset-2 active:opacity-70">
            처음 화면으로
          </button>
        </span>
        <button type="button" disabled={Boolean(leaving)} onClick={() => void leave('signup')}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[#FEE500] px-3 text-[0.8125rem] font-extrabold text-[#191F28] active:opacity-80 disabled:opacity-60">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none"><path fillRule="evenodd" clipRule="evenodd" d="M10 2C5.582 2 2 4.895 2 8.455c0 2.27 1.512 4.263 3.786 5.39l-.964 3.5a.25.25 0 00.38.273L9.58 15.1A9.18 9.18 0 0010 15.11c4.418 0 8-2.895 8-6.455S14.418 2 10 2z" fill="#191F28" /></svg>
          {leaving === 'signup' ? '여는 중...' : '가입하고 시작'}
        </button>
      </div>
    </>
  );
}
