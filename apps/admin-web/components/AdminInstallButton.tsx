'use client';

import { useEffect, useState } from 'react';

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

  useEffect(() => {
    setInstalled(isStandalone());
    setReady(true);

    function onPrompt(event: Event) {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setGuideOpen(false);
    }

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      setDeferred(null);
      return;
    }
    setGuideOpen(true);
  }

  if (!ready || installed) return null;

  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(userAgent);
  const inApp = /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp/i.test(userAgent);

  return (
    <>
      <button
        type="button"
        onClick={() => void install()}
        className={compact
          ? 'mt-3 flex h-12 w-full items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-4 text-left active:opacity-75'
          : 'mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/20 bg-white text-[13px] font-extrabold text-primary active:opacity-75'}
      >
        {compact ? (
          <>
            <span><b className="block text-[14px] text-ink">관리자 앱 설치</b><span className="mt-0.5 block text-[11px] text-sub">홈 화면에서 관리자 앱을 바로 열어요</span></span>
            <span className="text-[13px] font-extrabold text-primary">방법 보기 →</span>
          </>
        ) : (
          <>
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
            관리자 앱 설치·다운로드 방법
          </>
        )}
      </button>

      {guideOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35" onClick={() => setGuideOpen(false)}>
          <section role="dialog" aria-modal="true" aria-label="관리자 앱 설치 방법" className="w-full max-w-app rounded-t-3xl bg-white p-6 pb-[calc(24px+env(safe-area-inset-bottom))] text-ink shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <img src="/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
              <div className="min-w-0 flex-1"><p className="text-[17px] font-extrabold">잇닿 관리자 앱 설치</p><p className="mt-1 text-[12px] leading-5 text-sub">별도 앱스토어 다운로드 없이 현재 화면을 홈 화면에 추가하면 돼요.</p></div>
              <button type="button" aria-label="설치 안내 닫기" onClick={() => setGuideOpen(false)} className="px-2 py-1 text-[18px] text-sub">×</button>
            </div>

            {inApp ? (
              <div className="mt-5 rounded-2xl bg-bg p-4"><p className="text-[14px] font-extrabold">카카오톡에서는 먼저 외부 브라우저로 열어 주세요</p><ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-6 text-sub"><li>오른쪽 위 <b className="text-ink">⋮</b> 메뉴를 눌러요.</li><li><b className="text-ink">다른 브라우저로 열기</b>를 선택해요.</li><li>열린 크롬 또는 사파리에서 다시 설치 버튼을 눌러요.</li></ol></div>
            ) : ios ? (
              <div className="mt-5 rounded-2xl bg-bg p-4"><p className="text-[14px] font-extrabold">아이폰 · 아이패드</p><ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-6 text-sub"><li>이 페이지를 <b className="text-ink">Safari</b>에서 열어요.</li><li>아래쪽 <b className="text-ink">공유</b> 버튼을 눌러요.</li><li><b className="text-ink">홈 화면에 추가</b> → 추가를 눌러요.</li></ol></div>
            ) : (
              <div className="mt-5 rounded-2xl bg-bg p-4"><p className="text-[14px] font-extrabold">안드로이드 · 크롬</p><ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-6 text-sub"><li>크롬 오른쪽 위 <b className="text-ink">⋮</b> 메뉴를 눌러요.</li><li><b className="text-ink">앱 설치</b> 또는 <b className="text-ink">홈 화면에 추가</b>를 눌러요.</li><li>추가하면 홈 화면에 잇닿 관리자 아이콘이 생겨요.</li></ol></div>
            )}

            <button type="button" onClick={() => setGuideOpen(false)} className="mt-5 h-12 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white">확인</button>
          </section>
        </div>
      )}
    </>
  );
}
