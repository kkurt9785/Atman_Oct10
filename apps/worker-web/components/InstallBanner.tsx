'use client';

import { useEffect, useState } from 'react';
import { PwaInstallSheet } from './PwaInstallSheet';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'installBannerDismissedAt';
const DISMISS_DAYS = 14;

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari 전용 속성
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export function InstallBanner() {
  const [mode, setMode] = useState<'hidden' | 'ios' | 'android'>('hidden');
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      setMode('ios');
      return;
    }

    function onPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setMode('android');
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    setMode('hidden');
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') setMode('hidden');
    else dismiss();
  }

  if (mode === 'hidden') return null;

  return (
    <>
      <div className="fixed bottom-[calc(64px+env(safe-area-inset-bottom))] inset-x-3 z-40 max-w-app mx-auto bg-ink text-white rounded-2xl px-3 py-3 shadow-lg flex items-center gap-2 min-[360px]:gap-3 min-[360px]:px-4">
        <img src="/icon-192.png" alt="" className="hidden h-9 w-9 flex-shrink-0 rounded-xl min-[320px]:block" />
        <button type="button" onClick={mode === 'ios' ? () => setShowIosGuide(true) : install} className="min-w-0 flex-1 text-left">
          <p className="text-[12px] font-bold min-[360px]:text-[13px]">앱처럼 설치하고 알림 받기</p>
          <p className="mt-0.5 text-[11px] opacity-80">
            {mode === 'ios' ? '3단계 설치 방법 보기' : '홈 화면에서 바로 시프트를 확인하세요'}
          </p>
        </button>
        <button type="button" onClick={mode === 'ios' ? () => setShowIosGuide(true) : install} className="flex-shrink-0 whitespace-nowrap rounded-xl bg-white px-2.5 py-2 text-[12px] font-bold text-ink min-[360px]:px-3">
          {mode === 'ios' ? '방법 보기' : '설치'}
        </button>
        <button onClick={dismiss} aria-label="설치 안내 닫기" className="text-[16px] opacity-60 flex-shrink-0 px-1">✕</button>
      </div>
      {showIosGuide && <PwaInstallSheet onClose={() => setShowIosGuide(false)} />}
    </>
  );
}
