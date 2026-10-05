'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { KAKAO_OAUTH_STATE_KEY } from '@/lib/kakao-login';
import { loadWorkerShellContext, WORKER_SHELL_HOME } from '@/lib/worker-mode';

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = searchParams.get('code');
    const returnedState = searchParams.get('state');
    const expectedState = window.sessionStorage.getItem(KAKAO_OAUTH_STATE_KEY);
    window.sessionStorage.removeItem(KAKAO_OAUTH_STATE_KEY);
    if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
      setFailed(true);
      return;
    }

    async function exchange() {
      try {
        const redirectUri = `${window.location.origin}/auth/callback`;

        const res = await fetch('/api/kakao-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirectUri }),
        });

        const data = await res.json();

        if (data.error || !data.id_token) {
          router.replace('/onboarding');
          return;
        }

        const { data: signIn, error: signInError } = await supabase.auth.signInWithIdToken({
          provider: 'kakao',
          token: data.id_token,
        });

        if (signInError) {
          console.error('[auth] sign-in failed', signInError.message);
          setFailed(true);
          return;
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('onboarding_done')
          .single();

        if (profile?.onboarding_done) {
          const next=window.localStorage.getItem('atman_auth_next');
          if(next?.startsWith('/')){
            window.localStorage.removeItem('atman_auth_next');
            router.replace(next);
          }else{
            // 이미 가입한 사람은 마지막에 쓰던 쪽(근무 찾기 / 초대 근무)으로 — 초대 근무만 쓰는 사람이 근무 찾기 홈을 거쳐 튕기지 않게
            const context = await loadWorkerShellContext(signIn.user).catch(() => null);
            router.replace(WORKER_SHELL_HOME[context?.shell ?? 'medical']);
          }
        } else {
          router.replace('/onboarding?step=terms');
        }
      } catch (e) {
        console.error('[auth] callback error', e);
        setFailed(true);
      }
    }

    exchange();
  }, [searchParams, router]);

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-8 text-center">
        <p className="text-4xl mb-4">😥</p>
        <p className="text-[18px] font-bold text-ink">로그인에 실패했어요</p>
        <p className="text-[14px] text-sub mt-2 leading-6">일시적인 문제일 수 있어요.<br />잠시 후 다시 시도해 주세요.</p>
        <button
          onClick={() => router.replace('/onboarding')}
          className="mt-6 h-12 px-8 rounded-xl bg-primary text-white text-[15px] font-bold"
        >
          다시 로그인하기
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <CallbackInner />
    </Suspense>
  );
}
