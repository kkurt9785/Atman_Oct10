'use client';

import { useEffect, useState } from 'react';
import { PwaInstallSheet } from './PwaInstallSheet';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

// 첫 화면용 '앱 설치' 버튼. 로그인 전에도 바로 홈 화면에 둘 수 있게 한다.
//   안드로이드 크롬: 설치 창을 바로 띄운다 (beforeinstallprompt)
//   아이폰: 사파리 공유 → 홈 화면에 추가 안내
//   카카오톡·인스타 안의 브라우저처럼 설치가 안 되는 곳: 크롬으로 열도록 안내
// 이미 설치된 상태(standalone)에서는 아무것도 그리지 않는다.
export function InstallAppButton({ label = '홈 화면에 앱 추가', dark = false }: { label?: string; dark?: boolean }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const [guide, setGuide] = useState<'none' | 'ios' | 'browser'>('none');

  useEffect(() => {
    setInstalled(isStandalone());
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    function onPrompt(event: Event) {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }
    function onInstalled() { setInstalled(true); }
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
    setGuide(ios ? 'ios' : 'browser');
  }

  if (installed) return null;

  const inApp = /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent);

  return (
    <>
      <button type="button" onClick={() => void install()} className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl border text-[14px] font-extrabold ${dark ? 'border-white/20 bg-white/8 text-white' : 'border-line bg-white text-ink'}`}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
        {label}
      </button>
      {guide === 'ios' && <PwaInstallSheet onClose={() => setGuide('none')} />}
      {guide === 'browser' && (
        <div role="dialog" aria-label="앱 설치 방법" className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-app rounded-t-3xl bg-white p-6 text-ink shadow-2xl">
          <p className="text-[16px] font-extrabold">홈 화면에 앱으로 추가하기</p>
          {inApp
            ? <p className="mt-2 text-[13px] leading-5 text-sub">지금 열린 곳(카카오톡·인스타 등)의 브라우저에서는 설치가 안 돼요. 오른쪽 위 메뉴에서 <b className="text-ink">다른 브라우저로 열기</b>를 누르고 크롬에서 다시 시도해 주세요.</p>
            : <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] leading-5 text-sub"><li>크롬 오른쪽 위 <b className="text-ink">⋮</b> 메뉴를 누릅니다.</li><li><b className="text-ink">홈 화면에 추가</b> 또는 <b className="text-ink">앱 설치</b>를 누릅니다.</li><li>추가를 누르면 바탕화면에 아이콘이 생겨요.</li></ol>}
          <button type="button" onClick={() => setGuide('none')} className="mt-4 h-11 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white">확인</button>
        </div>
      )}
    </>
  );
}
