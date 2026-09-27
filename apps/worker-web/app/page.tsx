'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { loadWorkerShellContext, rememberWorkerShell, WORKER_SHELL_HOME } from '@/lib/worker-mode';
import { BrandMark, Wordmark } from '@/components/brand/BrandMark';
import { KakaoGlyph, startKakaoLogin } from '@/lib/kakao-login';

// 로그인 전 첫 화면은 로그인만 한다. 두 갈래를 나눠 두되 각 갈래의 버튼이 곧 시작이다 (1탭).
//   1) 병원·약국 근무 찾기 → 카카오 로그인 → 온보딩 → /home (근무표)
//   2) 초대받은 근무 출퇴근 → 초대 링크 확인 → /gig/join
// 근무표·공고 같은 내용은 로그인 뒤 화면이 맡는다. 여기에는 아무것도 더 쌓지 않는다.

function RootInner() {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  // 시연 진입은 ?demo=1 로 연 기기에서만 보인다. 실사용자 첫 화면에 데모를 노출하지 않는다.
  const [demoUnlocked, setDemoUnlocked] = useState(false);

  useEffect(() => {
    const wants = new URLSearchParams(window.location.search).get('demo') === '1';
    if (wants) window.localStorage.setItem('atman_demo_panel', '1');
    setDemoUnlocked(process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1' && (wants || window.localStorage.getItem('atman_demo_panel') === '1'));
  }, []);

  useEffect(() => {
    async function route() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSignedOut(true);
        return;
      }
      const [{ data: profile }, context] = await Promise.all([
        supabase.from('profiles').select('onboarding_done').single(),
        loadWorkerShellContext(user).catch(() => null),
      ]);
      if (profile?.onboarding_done) {
        // 긱 근무지만 있으면 /gig, 의료 쪽만 있으면 /home, 둘 다면 마지막에 쓴 셸 — 규칙은 lib/worker-mode.ts 하나에 있다
        router.replace(WORKER_SHELL_HOME[context?.shell ?? 'medical']);
      } else {
        router.replace('/onboarding?step=terms');
      }
    }
    route();
  }, [router]);

  // 긱워커 두 기기 시연: worker-demo-4 로 로그인하고 데모 근무지의 초대(토큰 고정)를 매번 초기화해 /gig/join 으로 간다.
  // 관리자 앱 '긱워커 근태 시연'의 팝업스토어 데모 근무지와 같은 초대라, 관리자 화면에서 복사한 링크·QR 도 이 계정으로 그대로 열린다.
  async function startGigDemo() {
    setInviteError('');
    setInviteLoading(true);
    try {
      const response = await fetch('/api/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'GIG2026' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.accessToken || !payload.refreshToken || !payload.gigInviteToken) {
        throw new Error(payload.error ?? '긱워커 데모를 열지 못했어요.');
      }
      const { error } = await supabase.auth.setSession({
        access_token: payload.accessToken,
        refresh_token: payload.refreshToken,
      });
      if (error) throw error;
      rememberWorkerShell('gig');
      router.replace(`/gig/join?token=${encodeURIComponent(payload.gigInviteToken)}`);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : '긱워커 데모를 열지 못했어요.');
    } finally {
      setInviteLoading(false);
    }
  }

  async function openInvite() {
    setInviteError('');
    const value = inviteLink.trim();
    if (demoUnlocked && value.toUpperCase() === 'GIG2026') {
      await startGigDemo();
      return;
    }
    const directToken = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? value : null;
    let token = directToken;
    if (!token) {
      try { token = new URL(value).searchParams.get('token'); } catch { token = null; }
    }
    if (!token) {
      setInviteError('관리자가 보낸 초대 링크 전체를 붙여 넣어 주세요.');
      return;
    }
    rememberWorkerShell('gig');
    router.push(`/gig/join?token=${encodeURIComponent(token)}`);
  }

  function startMedical() {
    rememberWorkerShell('medical');
    startKakaoLogin();
  }

  if (!signedOut) return <WorkerEntrySkeleton />;

  return <main className="min-h-screen bg-white px-6 pb-10 pt-16">
    <div className="mx-auto flex min-h-[calc(100vh-104px)] max-w-md flex-col">
      <div className="flex flex-col items-center gap-4 pt-10 text-center">
        <BrandMark size={72} />
        <Wordmark size={30} />
        <p className="text-[15px] leading-6 text-sub">병원·약국 근무를 찾는 사람에게도,<br />초대받아 오늘 출근하는 사람에게도 한 번에 닿는 근무 앱.</p>
      </div>

      <div className="flex-grow" />

      <section aria-label="병원·약국 근무 찾기" className="rounded-3xl bg-bg p-5">
        <p className="text-[12px] font-extrabold tracking-[0.08em] text-primary">병원 · 약국 근무 찾기</p>
        <p className="mt-1 text-[14px] text-sub">간호사 · 간호조무사 · 약사 · 약국 사무직</p>
        <button type="button" onClick={startMedical} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-btn bg-kakao text-[16px] font-extrabold text-ink shadow-btn active:opacity-80">
          <KakaoGlyph />카카오로 시작
        </button>
      </section>

      <section aria-label="초대받은 근무 출퇴근" className="mt-3 rounded-3xl border border-line bg-white p-5">
        <p className="text-[12px] font-extrabold tracking-[0.08em] text-ink">초대받은 근무 출퇴근</p>
        <p className="mt-1 text-[14px] text-sub">관리자가 보낸 링크나 QR로 들어오면 바로 연결돼요. 링크가 있다면 여기에 붙여 넣어도 돼요.</p>
        <div className="mt-3 flex gap-2">
          <input value={inviteLink} onChange={(event) => setInviteLink(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void openInvite()} placeholder="초대 링크 붙여넣기" aria-label="초대 링크" className="h-12 min-w-0 flex-1 rounded-xl bg-bg px-3 text-[14px] text-ink outline-none placeholder:text-tertiary" />
          <button type="button" onClick={() => void openInvite()} disabled={inviteLoading} className="h-12 shrink-0 rounded-xl bg-ink px-4 text-[14px] font-extrabold text-white disabled:opacity-60">확인</button>
        </div>
        {demoUnlocked && (
          <button type="button" onClick={() => void startGigDemo()} disabled={inviteLoading} className="mt-3 flex h-11 w-full items-center justify-between rounded-xl bg-primary/10 px-4 text-[13px] font-extrabold text-primary disabled:opacity-60">
            <span>긱워커 시연 시작 <span className="font-normal text-primary/70">· 팝업스토어 데모 초대</span></span><span>→</span>
          </button>
        )}
        {inviteError && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{inviteError}</p>}
      </section>

      <p className="mt-5 text-center text-[11px] text-tertiary">계속하면 이용약관과 개인정보처리방침에 동의하게 됩니다</p>
    </div>
  </main>;
}

function WorkerEntrySkeleton() {
  return (
    <main className="min-h-screen bg-white px-6 pt-16" aria-busy="true" aria-label="잇닿을 여는 중">
      <div className="flex flex-col items-center gap-4 pt-10">
        <BrandMark size={72} />
        <Wordmark size={30} />
      </div>
      <span className="sr-only">로그인 상태를 확인하고 있어요.</span>
    </main>
  );
}

export default function Root() {
  return (
    <Suspense fallback={<WorkerEntrySkeleton />}>
      <RootInner />
    </Suspense>
  );
}
