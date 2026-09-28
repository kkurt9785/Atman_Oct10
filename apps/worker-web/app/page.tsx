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

  function startMedical() {
    rememberWorkerShell('medical');
    startKakaoLogin();
  }

  if (!signedOut) return <WorkerEntrySkeleton />;

  return <main className="min-h-screen bg-white px-5 pb-8 pt-[max(32px,env(safe-area-inset-top))]">
    <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-md flex-col">
      <div className="flex flex-col items-center pt-3 text-center">
        <Wordmark size={34} />
        <h1 className="mt-7 whitespace-pre-line text-[25px] font-extrabold leading-[1.28] tracking-[-0.7px] text-ink">일을 찾거나,{`\n`}초대받은 근무를 시작하세요</h1>
        <p className="mt-2 text-[14px] leading-6 text-sub">내 상황에 맞는 시작 방법을 선택하세요.</p>
      </div>

      <div className="min-h-7 flex-grow" />

      <section aria-label="병원·약국 워커" className="rounded-3xl bg-bg p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-extrabold tracking-[0.08em] text-primary">병원 · 약국 워커</p>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-extrabold text-primary">구직 + 근무관리</span>
        </div>
        <p className="mt-2 text-[18px] font-extrabold text-ink">근무를 찾고 지원할게요</p>
        <p className="mt-1 text-[13px] leading-5 text-sub">근무 찾기 · 지원 · 근무표 · 출퇴근</p>
        <button type="button" onClick={startMedical} className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-btn bg-kakao text-[16px] font-extrabold text-ink shadow-btn active:opacity-80">
          <KakaoGlyph />병원·약국 워커로 시작
        </button>
      </section>

      <section aria-label="긱워커 간편모드" className="mt-3 rounded-3xl bg-ink p-5 text-white">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-extrabold tracking-[0.08em] text-primary">긱워커 · 간편모드</p>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-extrabold text-white/75">초대 근무만</span>
        </div>
        <p className="mt-2 text-[18px] font-extrabold">초대받은 근무를 시작할게요</p>
        <p className="mt-1 text-[13px] leading-5 text-white/65">잇기(초대 수락) · 닿기(출퇴근) · 대화 · 지급 확인</p>
        <Link href="/gig" onClick={() => rememberWorkerShell('gig')} className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-white text-[15px] font-extrabold text-ink active:opacity-80">
          긱워커로 시작 →
        </Link>
      </section>

      {DEMO_ENABLED && <details className="group mt-3 rounded-2xl border border-line bg-white">
        <summary className="flex h-11 cursor-pointer list-none items-center justify-center gap-2 text-[12px] font-extrabold text-sub">
          로그인 없이 체험하기 <span aria-hidden className="transition group-open:rotate-90">›</span>
        </summary>
        <div aria-label="데모 워커 선택" className="grid grid-cols-2 gap-2 border-t border-line p-3">
          <Link href="/demo" className="flex h-11 items-center justify-center rounded-xl bg-bg text-[12px] font-extrabold text-sub">병원·약국 데모</Link>
          <Link href="/gig/demo" className="flex h-11 items-center justify-center rounded-xl bg-ink text-[12px] font-extrabold text-white">긱워커 데모</Link>
        </div>
      </details>}

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
