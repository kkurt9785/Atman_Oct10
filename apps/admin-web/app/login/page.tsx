'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { supabase } from '@/lib/supabase-browser';
import { DemoShareCard } from './DemoShareCard';
import { subscribeToAdminPush } from '@/lib/push-subscribe';

// 시연용 계정. 노출 여부는 NEXT_PUBLIC_ENABLE_DEMO_LOGIN으로 빌드 시 결정된다.
const DEMO_ACCOUNTS = [
  { email: 'sales-demo-1@demo.atman.co.kr', label: '병원 시연 시작', detail: 'W여성병원' },
  { email: 'sales-demo-1@demo.atman.co.kr', label: '긱워커 근태 시연', detail: '팝업스토어', demoKind: 'gigworker' },
  { email: 'sales-demo-2@demo.atman.co.kr', label: '약국 시연', detail: '수원 온누리약국' },
  { email: 'sales-demo-3@demo.atman.co.kr', label: '요양병원 시연', detail: '수원요양병원' },
];

function LoginInner() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [demoLoadingEmail, setDemoLoadingEmail] = useState<string | null>(null);
  const [demoError, setDemoError] = useState('');
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  // 공개 시연 여부는 환경변수로만 제어한다.
  const showDemoLogin = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1';

  function handleKakaoLogin() {
    setLoading(true);
    const key = process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY;
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    const scope = encodeURIComponent('openid profile_nickname profile_image');
    window.location.href =
      `https://kauth.kakao.com/oauth/authorize?client_id=${key}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  }

  // 데모 로그인 — 클라이언트 로그인 후 HttpOnly 서버 세션·시설 컨텍스트를 순서대로 수립
  async function handleDemoLogin(email: string, demoKind?: string) {
    setDemoLoadingEmail(email);
    setDemoError('');
    try {
      const loginRes = await fetch('/api/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const loginData = await loginRes.json().catch(() => ({}));
      if (!loginRes.ok || !loginData.accessToken || !loginData.refreshToken) {
        throw new Error(loginData.error ?? '데모 계정 로그인 실패');
      }
      const { data, error: sessionError } = await supabase.auth.setSession({
        access_token: loginData.accessToken,
        refresh_token: loginData.refreshToken,
      });
      if (sessionError || !data.session) throw new Error('데모 세션을 만들지 못했어요.');

      try {
        const subscription = await subscribeToAdminPush();
        if (subscription) await supabase.from('push_subscriptions').upsert({
          worker_id: data.session.user.id, endpoint: subscription.endpoint, subscription: subscription.toJSON(), updated_at: new Date().toISOString(),
        }, { onConflict: 'worker_id,endpoint' });
      } catch {
        // 알림을 거부해도 관리자 데모 진입은 막지 않는다.
      }

      const sessionRes = await fetch('/api/admin-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!sessionRes.ok) throw new Error('관리자 세션 수립 실패');

      const facilityRes = await fetch('/api/set-facility', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ demoKind }),
      });
      const facilityData = await facilityRes.json().catch(() => ({}));
      router.replace(facilityData?.facilityId ? '/' : '/setup/claim-facility');
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : '데모 로그인에 실패했어요.');
      setDemoLoadingEmail(null);
    }
  }


  return (
    <div className="flex flex-col min-h-screen px-6">
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <span className="text-[32px] font-extrabold text-primary">잇닿</span>
        <span className="text-[15px] text-sub">병원·약국 모집 · 긱워커 근태 관리</span>
      </div>

      {error === 'unauthorized' && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <p role="alert" className="text-[13px] text-red-600 text-center">이 카카오 계정은 근무자용으로 가입돼 있어요.<br />사업장 계정은 다른 카카오 계정으로 로그인해 주세요.</p>
        </div>
      )}

      <div className="pb-10 flex flex-col gap-3">
        <button
          onClick={handleKakaoLogin}
          disabled={loading}
          className="w-full h-12 rounded-xl bg-[#FEE500] text-[#191F28] font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M10 2C5.582 2 2 4.895 2 8.455c0 2.27 1.512 4.263 3.786 5.39l-.964 3.5a.25.25 0 00.38.273L9.58 15.1A9.18 9.18 0 0010 15.11c4.418 0 8-2.895 8-6.455S14.418 2 10 2z" fill="#191F28"/>
          </svg>
          {loading ? '등록 중...' : '카카오로 관리자 등록·로그인'}
        </button>
        <p className="-mt-1 text-center text-[11px] leading-4 text-sub">처음이면 관리자 계정이 바로 만들어지고, 긱워커 근태는 사업자서류 없이 시작할 수 있어요.</p>

        {showDemoLogin && (
          <div className="mt-2 rounded-2xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-[14px] font-extrabold text-ink">로그인 없이 빠른 시연</p>
            <p className="mt-0.5 text-[12px] text-sub">대표 화면을 바로 보여드릴 수 있어요. 실제 데이터에는 반영되지 않아요.</p>
            <div className="flex flex-col gap-2">
              {DEMO_ACCOUNTS.map((account, index) => (
                <button
                  key={`${account.email}:${account.demoKind ?? 'default'}`}
                  onClick={() => handleDemoLogin(account.email, account.demoKind)}
                  disabled={loading || !!demoLoadingEmail}
                  className={`flex h-11 w-full items-center justify-between rounded-xl px-3 text-[14px] font-bold disabled:opacity-60 ${index === 0 ? 'bg-primary text-white shadow-sm' : 'border border-line bg-white text-ink'}`}
                >
                  <span>{demoLoadingEmail === account.email ? '시연 화면 여는 중...' : account.label}</span>
                  {demoLoadingEmail !== account.email && <span className={`text-[11px] font-semibold ${index === 0 ? 'text-white/75' : 'text-sub'}`}>{account.detail}</span>}
                </button>
              ))}
            </div>
            {demoError && (
              <p role="alert" className="text-[12px] font-bold text-red-500 text-center mt-2">{demoError}</p>
            )}
            <DemoShareCard />
          </div>
        )}

        <a
          href="https://itdot.co.kr"
          className="mt-4 block rounded-xl border border-line bg-white py-3 text-center text-[13px] font-semibold text-sub active:opacity-70"
        >
          근무하러 오셨나요? <span className="font-bold text-primary">잇닿 워커 앱으로 →</span>
        </a>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginInner />
    </Suspense>
  );
}
