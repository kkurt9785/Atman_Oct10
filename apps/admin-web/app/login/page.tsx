'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginInner() {
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  function handleKakaoLogin() {
    setLoading(true);
    const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    const scope = encodeURIComponent('openid profile_nickname profile_image');
    window.location.href =
      `https://kauth.kakao.com/oauth/authorize?client_id=${key}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
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
        <button
          onClick={handleKakaoLogin}
          disabled={loading}
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
