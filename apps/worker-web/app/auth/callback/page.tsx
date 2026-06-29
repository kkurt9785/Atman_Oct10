'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      router.replace('/onboarding');
      return;
    }

    async function exchange() {
      try {
        const redirectUri = `${window.location.origin}/auth/callback`;

        // 브라우저에서 Kakao 토큰 엔드포인트 직접 호출 (서버 우회 테스트)
        const kakaoRes = await fetch('https://kauth.kakao.com/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY!,
            redirect_uri: redirectUri,
            code: code!,
          }),
        });

        const data = await kakaoRes.json();

        if (data.error || !data.id_token) {
          alert('직접호출 결과:\n' + JSON.stringify(data, null, 2));
          router.replace('/onboarding');
          return;
        }

        const { error: signInError } = await supabase.auth.signInWithIdToken({
          provider: 'kakao',
          token: data.id_token,
        });

        if (signInError) {
          alert('로그인 실패: ' + signInError.message);
          router.replace('/onboarding');
          return;
        }

        router.replace('/home');
      } catch (e) {
        alert('오류: ' + String(e));
        router.replace('/onboarding');
      }
    }

    exchange();
  }, [searchParams, router]);

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
