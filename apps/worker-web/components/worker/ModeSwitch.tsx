'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isDemoEmail, MEDICAL_DEMOS, openDemoSession } from '@/lib/demo-session';
import { InviteLinkPaste } from '@/components/invite/InviteLinkPaste';
import { loadWorkerShellContext, rememberWorkerShell, WORKER_SHELL_HOME, type WorkerShell } from '@/lib/worker-mode';

// 병원·약국 ↔ 긱 근무 전환은 이 스위치 하나. 두 홈의 같은 자리(맨 위)에 같은 모양으로 둔다.
//   · 두 모드를 다 쓰면: 누르면 바로 전환
//   · 반대쪽 모드가 아직 없으면: 무엇을 하면 열리는지 안내(직군 등록 / 초대 링크)
//   · 시연 계정이면: 반대쪽 시연을 앱 안에서 바로 연다 — 초대 근무는 바로, 근무 찾기는 직군만 고르고
//     (진행자용 /demo·/gig/demo 안내 페이지로 보내지 않는다. 가입·처음 화면은 화면 아래 시연 띠 DemoBar)
const LABEL: Record<WorkerShell, string> = { medical: '근무 찾기', gig: '초대 근무' };

export function ModeSwitch({ current }: { current: WorkerShell }) {
  const router = useRouter();
  const [ctx, setCtx] = useState<{ hasGig: boolean; hasMedical: boolean; demo: boolean } | null>(null);
  const [sheet, setSheet] = useState<WorkerShell | null>(null);
  const [demoRoles, setDemoRoles] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void loadWorkerShellContext().then((context) => {
      if (!active || !context) return;
      setCtx({ hasGig: context.hasGig, hasMedical: context.hasMedical, demo: isDemoEmail(context.user.email) });
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function choose(target: WorkerShell) {
    if (target === current) return;
    if (ctx?.demo) {
      if (target === 'gig') { await switchDemo('gig'); return; }
      setDemoRoles(true);
      return;
    }
    const available = target === 'gig' ? ctx?.hasGig : ctx?.hasMedical;
    if (available) {
      rememberWorkerShell(target);
      router.push(WORKER_SHELL_HOME[target]);
      return;
    }
    setSheet(target);
  }

  // 시연 계정끼리 갈아타기 — 세션이 바뀌므로 새로 연다
  async function switchDemo(target: { email: string } | 'gig') {
    if (switching) return;
    setSwitching(target === 'gig' ? 'gig' : target.email);
    setError('');
    try {
      window.location.replace(await openDemoSession(target));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '시연을 열지 못했어요.');
      setSwitching(null);
    }
  }

  function startMedicalRegistration() {
    try { window.localStorage.removeItem('atman_auth_next'); } catch { /* 저장소 없어도 진행 */ }
    router.push('/onboarding?step=terms');
  }

  return (
    <>
      <div role="tablist" aria-label="근무 방식" className="inline-flex rounded-full border border-line bg-white p-0.5 shadow-sm">
        {(['medical', 'gig'] as const).map((shell) => {
          const on = shell === current;
          return (
            <button key={shell} type="button" role="tab" aria-selected={on} onClick={() => choose(shell)}
              className={`h-8 rounded-full px-3.5 text-[12px] font-extrabold transition-colors ${on ? 'bg-primary text-white' : 'text-sub active:bg-bg'}`}>
              {LABEL[shell]}
            </button>
          );
        })}
      </div>

      {demoRoles && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setDemoRoles(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="demo-roles-title" className="w-full max-w-md rounded-t-3xl bg-white px-6 pb-[calc(24px+env(safe-area-inset-bottom))] pt-6" onClick={(event) => event.stopPropagation()}>
            <p className="text-[12px] font-extrabold text-primary">근무 찾기 시연</p>
            <h2 id="demo-roles-title" className="mt-1 text-[20px] font-extrabold text-ink">어떤 직군으로 볼까요?</h2>
            <p className="mt-2 text-[14px] leading-6 text-sub">고른 직군의 근무표와 근처 공고로 바로 열려요.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {MEDICAL_DEMOS.map((demo) => (
                <button key={demo.email} type="button" disabled={Boolean(switching)} onClick={() => void switchDemo({ email: demo.email })}
                  className="h-12 rounded-xl border border-line bg-white text-[14px] font-extrabold text-ink active:bg-bg disabled:opacity-60">
                  {switching === demo.email ? '여는 중...' : demo.role}
                </button>
              ))}
            </div>
            {error && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{error}</p>}
            <button type="button" onClick={() => setDemoRoles(false)} className="mt-2 h-11 w-full text-[14px] font-bold text-sub">닫기</button>
          </div>
        </div>
      )}

      {sheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setSheet(null)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white px-6 pb-[calc(24px+env(safe-area-inset-bottom))] pt-6" onClick={(event) => event.stopPropagation()}>
            {sheet === 'medical' ? (
              <>
                <p className="text-[12px] font-extrabold text-primary">근무 찾기</p>
                <h2 className="mt-1 text-[20px] font-extrabold text-ink">근무 찾기도 시작해 볼까요?</h2>
                <p className="mt-2 text-[14px] leading-6 text-sub">직군(간호사·간호조무사·약사·약국 사무직)만 등록하면 근처 병원·약국 공고를 보고 바로 지원할 수 있어요. 지금의 초대 근무는 그대로 유지돼요.</p>
                <button type="button" onClick={startMedicalRegistration} className="mt-5 h-12 w-full rounded-btn bg-primary text-[15px] font-extrabold text-white">직군 등록하기</button>
              </>
            ) : (
              <>
                <p className="text-[12px] font-extrabold text-primary">초대 근무</p>
                <h2 className="mt-1 text-[20px] font-extrabold text-ink">초대 근무는 링크로 시작해요</h2>
                <p className="mt-2 text-[14px] leading-6 text-sub">사장님께 받은 초대 링크를 복사한 뒤 아래 버튼을 누르면 출퇴근·대화·지급이 한 번에 연결돼요.</p>
                <div className="mt-4">
                  <InviteLinkPaste triggerClassName="h-12 w-full rounded-btn bg-primary text-[15px] font-extrabold text-white" trigger="복사한 초대 링크 붙여넣기" />
                </div>
              </>
            )}
            <button type="button" onClick={() => setSheet(null)} className="mt-2 h-11 w-full text-[14px] font-bold text-sub">닫기</button>
          </div>
        </div>
      )}
    </>
  );
}
