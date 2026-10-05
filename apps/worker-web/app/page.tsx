'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { loadWorkerShellContext, rememberWorkerShell, WORKER_SHELL_HOME } from '@/lib/worker-mode';
import { Wordmark } from '@/components/brand/BrandMark';
import { KakaoGlyph, startKakaoLogin } from '@/lib/kakao-login';
import { InstallAppButton } from '@/components/InstallAppButton';

// 첫 화면은 기능을 나열하지 않고 워커 유형만 고른다.
// 병원·약국 워커는 구직까지 포함한 상위 셸, 긱워커는 초대 근무에 필요한 공통 기능만 쓰는 간편 셸이다.

const DEMO_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1';

function RootInner() {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);

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

  const [showInvite, setShowInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteError, setInviteError] = useState('');

  // 로그인 뒤 어느 화면으로 갈지는 데이터가 정한다(초대 근무만 있으면 초대 근무, 아니면 근무 찾기)
  function startLogin() {
    rememberWorkerShell('medical');
    startKakaoLogin();
  }

  function openInvite() {
    setInviteError('');
    const value = inviteLink.trim();
    let token: string | null = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? value : null;
    if (!token) { try { token = new URL(value).searchParams.get('token'); } catch { token = null; } }
    if (!token) { setInviteError('사장님이 보낸 초대 링크 전체를 붙여 넣어 주세요.'); return; }
    rememberWorkerShell('gig');
    router.push(`/gig/join?token=${encodeURIComponent(token)}`);
  }

  if (!signedOut) return <WorkerEntrySkeleton />;

  return <main className="min-h-screen bg-white px-5 pb-8 pt-[max(32px,env(safe-area-inset-top))]">
    <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-md flex-col">
      <div className="flex flex-col items-center pt-3 text-center">
        <Wordmark size={34} />
        <h1 className="mt-7 text-[25px] font-extrabold leading-[1.28] tracking-[-0.7px] text-ink">한 번 등록으로 계속 일하고,<br />입금은 바로 확인해요</h1>
        <p className="mt-2 text-[14px] leading-6 text-sub">새 근무는 알림으로 받고,<br />출근하기 한 번이면 일한 시간이 바로 남아요.</p>
      </div>

      {/* 두 가지 쓰임새는 같은 앱의 기능이다 — 고르게 하지 않고 보여만 준다 */}
      <ul className="mt-8 space-y-2" aria-label="잇닿 워커로 할 수 있는 일">
        <li className="flex items-start gap-3 rounded-2xl bg-bg p-4">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg></span>
          <span><b className="block text-[15px] text-ink">근무 찾기</b><span className="mt-0.5 block text-[13px] leading-5 text-sub">간호사·간호조무사·약사 · 한 번 등록하면 근처 병원·약국 새 근무를 알림으로 받아요</span></span>
        </li>
        <li className="flex items-start gap-3 rounded-2xl bg-bg p-4">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg></span>
          <span><b className="block text-[15px] text-ink">초대 근무</b><span className="mt-0.5 block text-[13px] leading-5 text-sub">사장님 링크로 한 번 연결하면 출근하기, 일한 시간, 입금까지 바로 확인해요</span></span>
        </li>
      </ul>

      <div className="min-h-7 flex-grow" />

      <button type="button" onClick={startLogin} className="flex h-14 w-full items-center justify-center gap-2 rounded-btn bg-kakao text-[16px] font-extrabold text-ink shadow-btn active:opacity-80">
        <KakaoGlyph />카카오로 시작하기
      </button>
      {!showInvite
        ? <button type="button" onClick={() => setShowInvite(true)} className="mt-2 h-11 text-[13px] font-bold text-sub">초대 링크를 받으셨나요? <span className="text-primary">링크 열기 →</span></button>
        : <div className="mt-3">
            <div className="flex gap-2">
              <input autoFocus value={inviteLink} onChange={(event) => setInviteLink(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && openInvite()} placeholder="초대 링크 붙여넣기" aria-label="초대 링크" className="h-12 min-w-0 flex-1 rounded-xl border border-line px-3 text-[14px] outline-none focus:border-primary" />
              <button type="button" onClick={openInvite} className="h-12 shrink-0 rounded-xl bg-primary px-4 text-[14px] font-extrabold text-white">열기</button>
            </div>
            {inviteError && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{inviteError}</p>}
          </div>}
      {DEMO_ENABLED && <Link href="/demo" className="flex h-9 items-center justify-center text-[12px] font-bold text-tertiary">로그인 없이 둘러보기 →</Link>}

      <div className="mt-2"><InstallAppButton label="잇닿 워커 앱 설치" /></div>
      <p className="mt-4 text-center text-[11px] text-tertiary">계속하면 이용약관과 개인정보처리방침에 동의하게 됩니다</p>
    </div>
  </main>;
}

function WorkerEntrySkeleton() {
  return (
    <main className="min-h-screen bg-white px-6 pt-16" aria-busy="true" aria-label="잇닿을 여는 중">
      <div className="flex flex-col items-center gap-3 pt-10">
        <Wordmark size={34} />
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
