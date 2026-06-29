'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export function Splash() {
  const [loading, setLoading] = useState(false);

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
        <span className="text-[32px] font-bold text-primary letter-tight tracking-[-0.5px]">atman</span>
        <span className="text-[15px] text-tertiary">간호사를 위한 야간 시프트</span>
      </div>

      <div className="pb-10 flex flex-col gap-3">
        <Button variant="kakao" onClick={handleKakaoLogin} disabled={loading}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M10 2C5.582 2 2 4.895 2 8.455c0 2.27 1.512 4.263 3.786 5.39l-.964 3.5a.25.25 0 00.38.273L9.58 15.1A9.18 9.18 0 0010 15.11c4.418 0 8-2.895 8-6.455S14.418 2 10 2z" fill="#191F28"/>
          </svg>
          {loading ? '로그인 중...' : '카카오로 시작하기'}
        </Button>
        <p className="text-center text-[13px] text-tertiary">
          계속 진행하면 이용약관 및 개인정보처리방침에 동의하게 됩니다
        </p>
      </div>
    </div>
  );
}
