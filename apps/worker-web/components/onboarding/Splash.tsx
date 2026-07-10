'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { supabase } from '@/lib/supabase';

const DEMO_PASSWORD = 'Atman-demo-2026!';
const DEMO_WORKERS = [
  { email: 'worker-demo-1@demo.atman.co.kr', label: '광주 RN' },
  { email: 'worker-demo-2@demo.atman.co.kr', label: '수원 장안 RN' },
  { email: 'worker-demo-3@demo.atman.co.kr', label: '수원 권선 NA' },
  { email: 'worker-demo-4@demo.atman.co.kr', label: '수원 팔달 RN' },
  { email: 'worker-demo-5@demo.atman.co.kr', label: '수원 영통 NA' },
];

export function Splash() {
  const [loading, setLoading] = useState(false);
  const [demoLoadingEmail, setDemoLoadingEmail] = useState<string | null>(null);
  const [demoError, setDemoError] = useState('');
  const showDemoLogin = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1' && process.env.NODE_ENV !== 'production';

  function handleKakaoLogin() {
    // 카카오 인앱 브라우저에서는 OAuth redirect가 차단됨 → 외부 브라우저로 탈출
    if (navigator.userAgent.includes('KAKAO')) {
      window.location.href =
        'kakaotalk://web/openExternal?url=' + encodeURIComponent(window.location.href);
      return;
    }

    setLoading(true);
    const key = process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY;
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback`);
    const scope = encodeURIComponent('openid profile_nickname profile_image');
    window.location.href =
      `https://kauth.kakao.com/oauth/authorize?client_id=${key}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;
  }

  async function handleDemoLogin(email: string) {
    setDemoLoadingEmail(email);
    setDemoError('');

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: DEMO_PASSWORD,
    });

    if (error) {
      setDemoError('데모 워커 로그인에 실패했습니다.');
      setDemoLoadingEmail(null);
      return;
    }

    window.location.href = '/home';
  }

  return (
    <div className="flex flex-col min-h-screen px-6">
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <span className="text-[32px] font-bold text-primary letter-tight tracking-[-0.5px]">atman</span>
        <span className="text-[15px] text-tertiary">간호사를 위한 야간 시프트</span>
      </div>

      <div className="pb-10 flex flex-col gap-3">
        <Link
          href="/shifts"
          className="w-full h-14 flex items-center justify-center rounded-btn bg-primary text-white text-[17px] font-bold shadow-btn active:opacity-80"
        >
          시프트 먼저 둘러보기
        </Link>
        <Button variant="kakao" onClick={handleKakaoLogin} disabled={loading}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M10 2C5.582 2 2 4.895 2 8.455c0 2.27 1.512 4.263 3.786 5.39l-.964 3.5a.25.25 0 00.38.273L9.58 15.1A9.18 9.18 0 0010 15.11c4.418 0 8-2.895 8-6.455S14.418 2 10 2z" fill="#191F28"/>
          </svg>
          {loading ? '로그인 중...' : '카카오로 1분 가입하기'}
        </Button>
        {showDemoLogin && (
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="mb-3 text-[13px] font-bold text-ink">시연용 워커 로그인</p>
            <div className="grid grid-cols-1 gap-2">
              {DEMO_WORKERS.map((worker) => (
                <button
                  key={worker.email}
                  type="button"
                  onClick={() => handleDemoLogin(worker.email)}
                  disabled={loading || !!demoLoadingEmail}
                  className="h-11 rounded-xl border border-line bg-bg text-[14px] font-semibold text-ink disabled:opacity-60"
                >
                  {demoLoadingEmail === worker.email ? '로그인 중...' : worker.label}
                </button>
              ))}
            </div>
            {demoError && <p className="mt-3 text-center text-[12px] text-red-600">{demoError}</p>}
          </div>
        )}
        <p className="text-center text-[13px] text-tertiary">
          계속 진행하면 이용약관 및 개인정보처리방침에 동의하게 됩니다
        </p>
      </div>
    </div>
  );
}
