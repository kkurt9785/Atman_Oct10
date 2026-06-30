'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code) {
      router.replace('/login');
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
          router.replace('/login');
          return;
        }

        const { error: signInError } = await supabase.auth.signInWithIdToken({
          provider: 'kakao',
          token: data.id_token,
        });

        if (signInError) {
          router.replace('/login');
          return;
        }

        // 관리자 계정 확인
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .single();

        if (profile?.role !== 'admin') {
          await supabase.auth.signOut();
          router.replace('/login?error=unauthorized');
          return;
        }

        // 내 병원 연결 여부 확인
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: facility } = await supabase
            .from('facilities')
            .select('id')
            .eq('admin_user_id', user.id)
            .maybeSingle();

          if (!facility) {
            // 병원 미연결 → 내 병원 찾기
            router.replace('/setup/claim-facility');
            return;
          }

          // 쿠키 설정 (Server Action 경유)
          const { setFacilityCookie } = await import('@/lib/facility');
          await setFacilityCookie(facility.id);
        }

        router.replace('/');
      } catch {
        router.replace('/login');
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
