'use client';

import { useEffect, useRef, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function AdminInstallButton({ compact = false }: { compact?: boolean }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ready, setReady] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setInstalled(isStandalone());
    setReady(true);

    function onPrompt(event: Event) {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
      setGuideOpen(false);
    }

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!guideOpen) return;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setGuideOpen(false); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)') ?? []);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [guideOpen]);

  async function install() {
    if (busyRef.current) return;
    setNotice('');
    if (inApp) { setGuideOpen(true); return; }
    if (deferred) {
      busyRef.current = true; setBusy(true);
      const prompt = deferred;
      setDeferred(null); // A native install prompt is single use.
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        setNotice(outcome === 'accepted' ? '설치를 요청했어요. 완료되면 홈 화면에서 관리자 앱을 열어 주세요.' : '설치를 취소했어요. 웹에서도 그대로 사용할 수 있어요.');
      } catch { setNotice('설치 창을 열지 못했어요. 아래 방법으로 홈 화면에 추가해 주세요.'); setGuideOpen(true); }
      finally { busyRef.current = false; setBusy(false); }
      return;
    }
    setGuideOpen(true);
  }

  if (!ready || installed) return null;

  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
  const inApp = /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp/i.test(userAgent);
  const installUrl = new URL('/login?install=1', window.location.origin).href;
  async function copyInstallLink() {
    try { await navigator.clipboard.writeText(installUrl); setNotice('설치 링크를 복사했어요. Safari 또는 Chrome 주소창에 붙여 넣어 주세요.'); }
    catch { setNotice('자동 복사가 안 돼요. 아래 주소를 길게 눌러 복사해 주세요.'); }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void install()}
        className={compact
          ? 'mt-3 flex h-12 w-full items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 text-left active:opacity-75'
          : 'mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/20 bg-white text-[0.8125rem] font-extrabold text-primary active:opacity-75'}
      >
        {compact ? (
          <>
            <span><b className="block text-[0.875rem] text-ink">관리자 앱 설치</b><span className="mt-0.5 block text-[0.6875rem] text-sub">홈 화면에서 관리자 앱을 바로 열어요</span></span>
            <span className="text-[0.8125rem] font-extrabold text-primary">방법 보기 →</span>
          </>
        ) : (
          <>
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            {busy ? '설치 창 확인 중…' : '관리자 앱 설치 방법'}
          </>
        )}
      </button>
      {notice&&!guideOpen&&<p role="status" className="mt-2 text-xs leading-5 text-sub">{notice}</p>}

      {guideOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35" onClick={() => setGuideOpen(false)}>
          <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="관리자 앱 설치 방법" className="max-h-[90dvh] w-full max-w-app overflow-y-auto rounded-t-3xl bg-white p-6 pb-[calc(24px+env(safe-area-inset-bottom))] text-ink shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <img src="/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
              <div className="min-w-0 flex-1"><p className="text-[1.0625rem] font-extrabold">잇닿 관리자 앱 설치</p><p className="mt-1 text-[0.75rem] leading-5 text-sub">별도 앱스토어 다운로드 없이 현재 화면을 홈 화면에 추가하면 돼요.</p></div>
              <button type="button" aria-label="설치 안내 닫기" onClick={() => setGuideOpen(false)} className="h-11 w-11 shrink-0 text-[1.125rem] text-sub">×</button>
            </div>

            {inApp ? (
              <div className="mt-5 rounded-2xl bg-bg p-4"><p className="text-[0.875rem] font-extrabold">먼저 Safari 또는 Chrome에서 열어 주세요</p><ol className="mt-2 list-decimal space-y-1 pl-5 text-[0.8125rem] leading-6 text-sub"><li>현재 앱의 메뉴에서 <b className="text-ink">외부 브라우저로 열기</b>를 찾아요. 메뉴 이름·위치는 앱마다 달라요.</li><li>없으면 아래 링크를 복사해 브라우저 주소창에 붙여 넣어요.</li><li>열린 브라우저에서 다시 설치 버튼을 눌러요.</li></ol>{/KAKAOTALK/i.test(userAgent)&&<button type="button" onClick={()=>{setNotice('전환되지 않으면 링크를 복사해 브라우저에서 열어 주세요.');window.location.href='kakaotalk://web/openExternal?url='+encodeURIComponent(installUrl);}} className="mt-3 min-h-11 w-full rounded-xl bg-white px-3 text-sm font-bold text-primary">외부 브라우저로 열기</button>}</div>
            ) : ios ? (
              <div className="mt-5 rounded-2xl bg-bg p-4"><p className="text-[0.875rem] font-extrabold">아이폰 · 아이패드</p><ol className="mt-2 list-decimal space-y-1 pl-5 text-[0.8125rem] leading-6 text-sub"><li>이 페이지를 <b className="text-ink">Safari</b>에서 열어요.</li><li>도구 막대 또는 메뉴의 <b className="text-ink">공유</b>를 눌러요.</li><li><b className="text-ink">홈 화면에 추가</b>를 선택해요. 없으면 공유 메뉴의 동작 편집에서 찾아요.</li><li><b className="text-ink">웹 앱으로 열기</b> 옵션이 보이면 켠 뒤 <b className="text-ink">추가</b>를 눌러요.</li></ol></div>
            ) : (
              <div className="mt-5 rounded-2xl bg-bg p-4"><p className="text-[0.875rem] font-extrabold">안드로이드 · 크롬</p><ol className="mt-2 list-decimal space-y-1 pl-5 text-[0.8125rem] leading-6 text-sub"><li>크롬 오른쪽 위 <b className="text-ink">⋮</b> 메뉴를 눌러요.</li><li><b className="text-ink">앱 설치</b> 또는 <b className="text-ink">홈 화면에 추가</b>를 눌러요.</li><li>추가하면 홈 화면에 잇닿 관리자 아이콘이 생겨요.</li></ol></div>
            )}
            {inApp&&<div className="mt-3"><button type="button" onClick={()=>void copyInstallLink()} className="h-11 w-full rounded-xl border border-line px-3 text-sm font-bold text-primary">설치 링크 복사</button><label className="mt-2 block text-xs text-sub">직접 복사할 주소<input readOnly value={installUrl} onFocus={event=>event.currentTarget.select()} className="mt-1 h-11 w-full rounded-lg border border-line px-2 text-base text-ink"/></label></div>}
            {notice&&<p role="status" className="mt-3 text-sm leading-5 text-sub">{notice}</p>}

            <button type="button" onClick={() => setGuideOpen(false)} className="mt-5 h-12 w-full rounded-xl bg-primary text-[0.875rem] font-extrabold text-white">확인</button>
          </section>
        </div>
      )}
    </>
  );
}
