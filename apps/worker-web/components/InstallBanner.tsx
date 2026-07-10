'use client';

import { useEffect, useState } from 'react';

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
    <div className="fixed bottom-[64px] inset-x-3 z-40 max-w-app mx-auto bg-ink text-white rounded-2xl px-4 py-3 shadow-lg flex items-center gap-3">
      <img src="/icon-192.png" alt="" className="w-9 h-9 rounded-xl flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold">앱처럼 설치하고 알림 받기</p>
        {mode === 'ios' ? (
          <p className="text-[11px] opacity-80 mt-0.5">
            Safari 하단 <span className="font-bold">공유 버튼</span> → <span className="font-bold">홈 화면에 추가</span>
          </p>
        ) : (
          <p className="text-[11px] opacity-80 mt-0.5">홈 화면에서 바로 시프트를 확인하세요</p>
        )}
      </div>
      {mode === 'android' && (
        <button onClick={install} className="text-[12px] font-bold bg-white text-ink rounded-xl px-3 py-2 flex-shrink-0">
          설치
        </button>
      )}
      <button onClick={dismiss} aria-label="닫기" className="text-[16px] opacity-60 flex-shrink-0 px-1">
        ✕
      </button>
    </div>
  );
}
