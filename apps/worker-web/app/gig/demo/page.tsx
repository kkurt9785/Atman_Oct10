'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { rememberWorkerShell } from '@/lib/worker-mode';
import { BrandMark, Wordmark } from '@/components/brand/BrandMark';

// 긱워커 시연 전용 입구: itdot.co.kr/gig/demo
// 버튼 하나로 시연 계정(worker-demo-4)에 로그인하고, 팝업스토어 데모 근무지의 초대를 초기화해 초대 확인 화면으로 간다.
// 관리자 앱 '긱워커 근태 시연'과 같은 근무지·같은 초대라 두 기기 시연이 그대로 이어진다. 몇 번을 눌러도 처음 상태로 돌아온다.
// 노출은 NEXT_PUBLIC_ENABLE_DEMO_LOGIN 으로만 막는다 (주소를 아는 사람만 온다).

const ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1';

export default function GigDemoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setError('');
    setLoading(true);
    try {
      // 다른 계정으로 로그인돼 있어도 시연 계정으로 바꿔 탄다
      await supabase.auth.signOut().catch(() => undefined);
      const response = await fetch('/api/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'GIG2026' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.accessToken || !payload.refreshToken || !payload.gigInviteToken) {
        throw new Error(payload.error ?? '시연 계정을 열지 못했어요.');
      }
      const { error: sessionError } = await supabase.auth.setSession({ access_token: payload.accessToken, refresh_token: payload.refreshToken });
      if (sessionError) throw sessionError;
      window.localStorage.setItem('atman_demo_panel', '1');
      rememberWorkerShell('gig');
      router.replace(`/gig/join?token=${encodeURIComponent(payload.gigInviteToken)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '시연 계정을 열지 못했어요.');
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-ink px-6 pb-10 pt-16 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-104px)] max-w-md flex-col">
        <div className="flex items-center justify-between">
          <Wordmark size={20} tone="dark" suffix="GIG" />
          <span className="rounded-full bg-white/15 px-3 py-1 text-[10px] font-extrabold tracking-[0.14em]">DEMO</span>
        </div>

        <div className="mt-14 flex flex-col items-center text-center">
          <BrandMark size={72} tone="dark" />
          <h1 className="mt-6 text-[28px] font-extrabold leading-tight tracking-[-0.8px]">긱워커 시연</h1>
          <p className="mt-3 text-[14px] leading-6 text-white/70">버튼 하나로 시연 계정에 로그인하고<br />팝업스토어 데모 근무지의 초대를 받은 상태로 시작해요.</p>
        </div>

        <ol className="mt-8 space-y-2 rounded-2xl bg-white/8 p-4 text-[13px] leading-5 text-white/80">
          <li><b className="text-white">1.</b> 아래 버튼 → 초대 확인 화면에서 <b className="text-white">초대 수락</b></li>
          <li><b className="text-white">2.</b> 오늘 근무 화면에서 <b className="text-white">닿기</b>를 길게 눌러 출근</li>
          <li><b className="text-white">3.</b> 관리자 앱(긱워커 근태 시연)에서 출근·워크룸이 바로 반영되는지 확인</li>
          <li className="text-white/55">다시 누르면 언제든 처음 상태(초대 대기)로 돌아와요.</li>
        </ol>

        <div className="flex-grow" />

        {ENABLED ? (
          <button type="button" onClick={() => void start()} disabled={loading} className="flex h-14 w-full items-center justify-center rounded-btn bg-primary text-[16px] font-extrabold text-white shadow-btn disabled:opacity-60">
            {loading ? '시연 계정 준비 중...' : '시연 계정으로 시작'}
          </button>
        ) : (
          <p className="rounded-2xl bg-white/10 p-4 text-center text-[13px] text-white/70">이 배포에서는 시연 로그인이 꺼져 있어요.</p>
        )}
        {error && <p role="alert" className="mt-3 text-center text-[12px] font-bold text-red-300">{error}</p>}
        <Link href="/" className="mt-3 flex h-10 items-center justify-center text-[13px] font-bold text-white/60">일반 로그인으로 가기</Link>
      </div>
    </main>
  );
}
