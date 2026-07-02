'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { supabase } from '@/lib/supabase-browser';

const DEMO_PASSWORD = 'Atman-demo-2026!';
const DEMO_ACCOUNTS = [
  { email: 'sales-demo-1@atman.local', label: '슈퍼계정 1' },
  { email: 'sales-demo-2@atman.local', label: '슈퍼계정 2' },
  { email: 'sales-demo-3@atman.local', label: '슈퍼계정 3' },
];

function LoginInner() {
  const [loading, setLoading] = useState(false);
  const [demoLoadingEmail, setDemoLoadingEmail] = useState<string | null>(null);
  const [demoError, setDemoError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const showDemoLogin = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1';

  function handleKakaoLogin() {
    setLoading(true);
    const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    const scope = encodeURIComponent('openid profile_nickname profile_image');
    window.location.href =
      `https://kauth.kakao.com/oauth/authorize?client_id=${key}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  }

  async function handleDemoLogin(email: string) {
    setDemoLoadingEmail(email);
    setDemoError('');

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: DEMO_PASSWORD,
    });

    if (signInError || !data.session?.access_token) {
      setDemoError('데모 계정 로그인에 실패했습니다. 로컬 시드 적용 여부를 확인해주세요.');
      setDemoLoadingEmail(null);
      return;
    }

    const facilityRes = await fetch('/api/set-facility', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
      },
    });

    const facilityData = await facilityRes.json().catch(() => ({}));
    setDemoLoadingEmail(null);

    if (facilityRes.ok && facilityData.facilityId) {
      router.replace('/');
      router.refresh();
      return;
    }

    router.replace('/setup/claim-facility');
  }

  return (
    <div className="flex flex-col min-h-screen px-6">
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <span className="text-[32px] font-extrabold text-primary">잇닿</span>
        <span className="text-[15px] text-sub">사장님 관리 콘솔</span>
      </div>

      {error === 'unauthorized' && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
          <p className="text-[13px] text-red-600 text-center">등록된 관리자 계정이 아닙니다.<br />담당자에게 문의해주세요.</p>
        </div>
      )}

      <div className="pb-10 flex flex-col gap-3">
        {showDemoLogin && (
          <div className="rounded-2xl border border-[#E5E8EB] bg-white p-4">
            <p className="mb-3 text-[13px] font-bold text-main">시연용 슈퍼계정</p>
            <div className="grid grid-cols-1 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => handleDemoLogin(account.email)}
                  disabled={loading || !!demoLoadingEmail}
                  className="h-11 rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] text-[14px] font-semibold text-[#191F28] disabled:opacity-60"
                >
                  {demoLoadingEmail === account.email ? '로그인 중...' : `${account.label} 로그인`}
                </button>
              ))}
            </div>
            {demoError && (
              <p className="mt-3 text-center text-[12px] leading-5 text-red-600">{demoError}</p>
            )}
          </div>
        )}
        <button
          onClick={handleKakaoLogin}
          disabled={loading || !!demoLoadingEmail}
          className="w-full h-12 rounded-xl bg-[#FEE500] text-[#191F28] font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M10 2C5.582 2 2 4.895 2 8.455c0 2.27 1.512 4.263 3.786 5.39l-.964 3.5a.25.25 0 00.38.273L9.58 15.1A9.18 9.18 0 0010 15.11c4.418 0 8-2.895 8-6.455S14.418 2 10 2z" fill="#191F28"/>
          </svg>
          {loading ? '로그인 중...' : '카카오로 로그인'}
        </button>
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
