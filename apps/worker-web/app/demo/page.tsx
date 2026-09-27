'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { rememberWorkerShell } from '@/lib/worker-mode';
import { BrandMark, Wordmark } from '@/components/brand/BrandMark';

// 병원·약국 워커 전용 시연 입구: itdot.co.kr/demo
// 긱워커 간편모드 시연은 /gig/demo 로 분리해, 첫 화면부터 두 모드가 섞여 보이지 않게 한다.
// 노출은 NEXT_PUBLIC_ENABLE_DEMO_LOGIN 으로만 막는다 (주소를 아는 사람만 온다).

const ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1';
const MEDICAL_DEMOS = [
  { email: 'worker-demo-1@demo.atman.co.kr', role: '간호사', detail: '10명 내외 병원 · 요양병원 근무 찾기' },
  { email: 'worker-demo-5@demo.atman.co.kr', role: '간호조무사', detail: '요양병원 근무 찾기' },
  { email: 'worker-demo-6@demo.atman.co.kr', role: '약사', detail: '대체약사 · 주말 약국' },
  { email: 'worker-demo-2@demo.atman.co.kr', role: '약국 전산·사무직', detail: '약국 접수·전산' },
];

export default function WorkerDemoPage() {
  const router = useRouter();
  const [loadingEmail, setLoadingEmail] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function start(email: string) {
    setError('');
    setLoadingEmail(email);
    try {
      await supabase.auth.signOut().catch(() => undefined);
      const response = await fetch('/api/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.accessToken || !payload.refreshToken) throw new Error(payload.error ?? '시연 계정을 열지 못했어요.');
      const { error: sessionError } = await supabase.auth.setSession({ access_token: payload.accessToken, refresh_token: payload.refreshToken });
      if (sessionError) throw sessionError;
      window.localStorage.setItem('atman_demo_panel', '1');
      window.localStorage.removeItem('atman_auth_next');
      rememberWorkerShell('medical');
      router.replace('/home');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '시연 계정을 열지 못했어요.');
      setLoadingEmail(null);
    }
  }

  return (
    <main className="min-h-screen bg-white px-6 pb-10 pt-14">
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between">
          <Wordmark size={20} />
          <span className="rounded-full bg-ink px-3 py-1 text-[10px] font-extrabold tracking-[0.14em] text-white">DEMO</span>
        </div>

        <div className="mt-10 flex flex-col items-center text-center">
          <BrandMark size={64} />
          <h1 className="mt-5 text-[26px] font-extrabold leading-tight tracking-[-0.8px] text-ink">병원·약국 워커 시연</h1>
          <p className="mt-2 text-[14px] leading-6 text-sub">직군 하나를 고르면 그 시연 계정으로 바로 로그인돼요.<br />근무표 홈 → 근무 찾기·지원 → 출퇴근 흐름을 볼 수 있어요.</p>
        </div>

        <p className="mt-8 text-[12px] font-extrabold tracking-[0.08em] text-primary">병원 · 약국 근무 찾기</p>
        <div className="mt-2 flex flex-col gap-2">
          {MEDICAL_DEMOS.map((demo) => (
            <button key={demo.email} type="button" onClick={() => void start(demo.email)} disabled={!ENABLED || Boolean(loadingEmail)} className="flex items-center justify-between rounded-2xl bg-bg px-4 py-4 text-left active:opacity-80 disabled:opacity-60">
              <span className="flex flex-col gap-0.5"><b className="text-[15px] text-ink">{demo.role}</b><span className="text-[12px] text-sub">{demo.detail}</span></span>
              <span className="shrink-0 text-[13px] font-extrabold text-primary">{loadingEmail === demo.email ? '여는 중...' : '시작 →'}</span>
            </button>
          ))}
        </div>

        <Link href="/gig/demo" className="mt-6 flex items-center justify-between rounded-2xl border border-ink px-4 py-4 text-ink active:bg-bg">
          <span className="flex flex-col gap-0.5"><b className="text-[14px]">긱워커는 간편모드에서</b><span className="text-[12px] text-sub">초대 → 닿기 출퇴근 데모</span></span>
          <span className="shrink-0 text-[13px] font-extrabold">별도 보기 →</span>
        </Link>

        {!ENABLED && <p className="mt-4 rounded-2xl bg-bg p-4 text-center text-[13px] text-sub">이 배포에서는 시연 로그인이 꺼져 있어요.</p>}
        {error && <p role="alert" className="mt-3 text-center text-[12px] font-bold text-red-600">{error}</p>}
        <Link href="/" className="mt-4 flex h-10 items-center justify-center text-[13px] font-bold text-tertiary">일반 로그인으로 가기</Link>
      </div>
    </main>
  );
}
