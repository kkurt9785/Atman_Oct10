'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getSignedInUser } from '@/lib/auth-user';
import { loadWorkerShellContext, rememberWorkerShell, WORKER_SHELL_HOME } from '@/lib/worker-mode';
import { Wordmark } from '@/components/brand/BrandMark';
import { KakaoGlyph, startKakaoLogin } from '@/lib/kakao-login';
import { InstallAppButton } from '@/components/InstallAppButton';
import { DEMO_LOGIN_ENABLED, MEDICAL_DEMOS, openDemoSession } from '@/lib/demo-session';
import { InviteLinkPaste } from '@/components/invite/InviteLinkPaste';

// 첫 화면은 가입 버튼 하나. 두 쓰임새(근무 찾기 = 병원·약국 직군, 초대 근무 = 단기 알바) 카드는 누르면 그 시연이 바로 열린다.
// 시연 로그인이 꺼진 배포에서는 카드가 설명만 남는다.

function RootInner() {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    async function route() {
      const user = await getSignedInUser();
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

  const [rolesOpen, setRolesOpen] = useState(false);
  const [demoLoading, setDemoLoading] = useState<string | null>(null);
  const [demoError, setDemoError] = useState('');

  async function tryDemo(target: { email: string } | 'gig') {
    setDemoError('');
    setDemoLoading(target === 'gig' ? 'gig' : target.email);
    try {
      router.replace(await openDemoSession(target));
    } catch (caught) {
      setDemoError(caught instanceof Error ? caught.message : '시연을 열지 못했어요.');
      setDemoLoading(null);
    }
  }

  // 로그인 뒤 어느 화면으로 갈지는 데이터가 정한다(초대 근무만 있으면 초대 근무, 아니면 근무 찾기)
  function startLogin() {
    rememberWorkerShell('medical');
    startKakaoLogin();
  }

  if (!signedOut) return <WorkerEntrySkeleton />;

  return <main className="min-h-screen bg-white px-5 pb-8 pt-[max(32px,env(safe-area-inset-top))]">
    <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-md flex-col">
      <div className="flex flex-col items-center pt-3 text-center">
        <Wordmark size={34} />
        <h1 className="mt-7 text-[26px] font-extrabold leading-[1.3] tracking-[-0.8px] text-ink">내가 일 찾는 시대는 끝.<br />한 번 등록으로<br />원하는 일은 바로</h1>
        <p className="mt-3 text-[14px] leading-6 text-sub"><b className="text-[15px] text-ink">시급 계산, 어렵지 않아요.</b><br />출근·퇴근만 누르면 일한 시간과 금액이 바로 나와요.</p>
      </div>

      {/* 두 쓰임새는 같은 앱의 기능이다 — 고르게 하지 않고, 눌러서 써 보게 한다 */}
      <ul className="mt-8 space-y-2" aria-label="잇닿 워커로 할 수 있는 일">
        <li className="rounded-2xl bg-bg">
          <FeatureCard icon={SEARCH_ICON} title="근무 찾기" tag="병원·약국 직군" desc="한 번 등록, 가까운 병원·약국 근무 알림"
            action={DEMO_LOGIN_ENABLED ? { label: rolesOpen ? '접기' : '써보기', expanded: rolesOpen, onClick: () => setRolesOpen((open) => !open) } : undefined} />
          {DEMO_LOGIN_ENABLED && rolesOpen && <div className="px-4 pb-4">
            <p className="text-[12px] font-bold text-sub">직군을 고르면 그 화면으로 바로 열려요</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {MEDICAL_DEMOS.map((demo) => (
                <button key={demo.email} type="button" disabled={Boolean(demoLoading)} onClick={() => void tryDemo({ email: demo.email })}
                  className="h-11 rounded-xl border border-line bg-white text-[13px] font-extrabold text-ink active:bg-bg disabled:opacity-60">
                  {demoLoading === demo.email ? '여는 중...' : demo.role}
                </button>
              ))}
            </div>
          </div>}
        </li>
        <li className="rounded-2xl bg-bg">
          <FeatureCard icon={INVITE_ICON} title="초대 근무" tag="단기 알바" desc="사장님 링크로 연결, 입금까지 바로 확인"
            action={DEMO_LOGIN_ENABLED ? { label: demoLoading === 'gig' ? '여는 중...' : '써보기', onClick: () => { if (!demoLoading) void tryDemo('gig'); } } : undefined} />
        </li>
      </ul>
      {DEMO_LOGIN_ENABLED && <p className="mt-2 text-center text-[11px] text-tertiary">써보기는 로그인 없이 열려요 · 둘러본 뒤 바로 가입할 수 있어요</p>}
      {demoError && <p role="alert" className="mt-2 text-center text-[12px] font-bold text-red-600">{demoError}</p>}

      <div className="min-h-7 flex-grow" />

      <button type="button" onClick={startLogin} className="flex h-14 w-full items-center justify-center gap-2 rounded-btn bg-kakao text-[16px] font-extrabold text-ink shadow-btn active:opacity-80">
        <KakaoGlyph />카카오로 시작하기
      </button>
      {/* 누르면 복사해 둔 링크로 바로 열린다 — 키보드가 올라와 화면이 밀리지 않게 */}
      <div className="mt-2 text-center">
        <InviteLinkPaste triggerClassName="h-11 w-full text-[13px] font-bold text-sub" trigger={<>초대 링크를 복사해 두셨나요? <span className="text-primary">붙여넣고 열기 →</span></>} />
      </div>
      <div className="mt-2"><InstallAppButton label="잇닿 워커 앱 설치" /></div>
      <p className="mt-4 text-center text-[11px] text-tertiary">계속하면 이용약관과 개인정보처리방침에 동의하게 됩니다</p>
    </div>
  </main>;
}

const SEARCH_ICON = <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>;
const INVITE_ICON = <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg>;

// 시연이 켜져 있으면 카드 전체가 버튼(제목 줄 오른쪽 '써보기'), 꺼져 있으면 설명만.
// 버튼을 제목 줄에 둬야 설명이 카드 폭을 다 써서 한 줄에 들어간다.
function FeatureCard({ icon, title, tag, desc, action }: {
  icon: ReactNode; title: string; tag: string; desc: string;
  action?: { label: string; onClick: () => void; expanded?: boolean };
}) {
  const body = <>
    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5">
        <b className="text-[15px] text-ink">{title}</b>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-sub">{tag}</span>
        {action && <span className="ml-auto shrink-0 rounded-full bg-primary px-2.5 py-1 text-[12px] font-extrabold text-white">
          {action.label}{action.expanded === undefined ? ' →' : action.expanded ? ' ▴' : ' ▾'}
        </span>}
      </span>
      <span className="mt-1 block text-[13px] leading-5 text-sub [word-break:keep-all]">{desc}</span>
    </span>
  </>;
  if (!action) return <div className="flex items-start gap-3 p-4">{body}</div>;
  return (
    <button type="button" onClick={action.onClick} aria-expanded={action.expanded} className="flex w-full items-start gap-3 p-4 text-left active:opacity-80">
      {body}
    </button>
  );
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
