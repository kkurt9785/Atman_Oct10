'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { loadWorkerShellContext, rememberWorkerShell, setGigworkerModePreference, WORKER_SHELL_HOME, type WorkerShell } from '@/lib/worker-mode';

// 병원·약국 ↔ 긱 근무 전환은 이 스위치 하나. 두 홈의 같은 자리(맨 위)에 같은 모양으로 둔다.
//   · 두 모드를 다 쓰면: 누르면 바로 전환
//   · 반대쪽 모드가 아직 없으면: 무엇을 하면 열리는지 안내(직군 등록 / 초대 링크)
//   · 시연 계정이면: 반대쪽 시연으로 바로 이동
const LABEL: Record<WorkerShell, string> = { medical: '근무 찾기', gig: '초대 근무' };

export function ModeSwitch({ current }: { current: WorkerShell }) {
  const router = useRouter();
  const [ctx, setCtx] = useState<{ hasGig: boolean; hasMedical: boolean; demo: boolean } | null>(null);
  const [sheet, setSheet] = useState<WorkerShell | null>(null);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void loadWorkerShellContext().then((context) => {
      if (!active || !context) return;
      const email = context.user.email?.toLowerCase() ?? '';
      setCtx({ hasGig: context.hasGig, hasMedical: context.hasMedical, demo: email.endsWith('@demo.atman.co.kr') });
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function choose(target: WorkerShell) {
    if (target === current) return;
    if (ctx?.demo) {
      await supabase.auth.signOut().catch(() => undefined);
      setGigworkerModePreference(false);
      window.location.href = target === 'gig' ? '/gig/demo' : '/demo';
      return;
    }
    const available = target === 'gig' ? ctx?.hasGig : ctx?.hasMedical;
    if (available) {
      rememberWorkerShell(target);
      router.push(WORKER_SHELL_HOME[target]);
      return;
    }
    setError('');
    setSheet(target);
  }

  function openInvite() {
    const value = link.trim();
    let token: string | null = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? value : null;
    if (!token) { try { token = new URL(value).searchParams.get('token'); } catch { token = null; } }
    if (!token) { setError('사장님이 보낸 초대 링크 전체를 붙여 넣어 주세요.'); return; }
    rememberWorkerShell('gig');
    router.push(`/gig/join?token=${encodeURIComponent(token)}`);
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
      {ctx?.demo && <span className="ml-2 align-middle text-[11px] font-bold text-tertiary">시연 중</span>}

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
                <p className="mt-2 text-[14px] leading-6 text-sub">사장님께 받은 초대 링크를 열면 출퇴근·대화·지급이 한 번에 연결돼요.</p>
                <div className="mt-4 flex gap-2">
                  <input value={link} onChange={(event) => setLink(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && openInvite()}
                    placeholder="초대 링크 붙여넣기" className="h-12 min-w-0 flex-1 rounded-xl border border-line px-3 text-[14px] outline-none focus:border-primary" />
                  <button type="button" onClick={openInvite} className="h-12 shrink-0 rounded-xl bg-primary px-4 text-[14px] font-extrabold text-white">열기</button>
                </div>
                {error && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{error}</p>}
              </>
            )}
            <button type="button" onClick={() => setSheet(null)} className="mt-2 h-11 w-full text-[14px] font-bold text-sub">닫기</button>
          </div>
        </div>
      )}
    </>
  );
}
