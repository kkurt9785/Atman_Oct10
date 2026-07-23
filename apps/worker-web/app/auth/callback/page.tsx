'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      router.replace('/onboarding');
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

        const { error: signInError } = await supabase.auth.signInWithIdToken({
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
            router.replace('/home');
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
