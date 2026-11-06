'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePwaInstall } from '@/lib/pwa-install';
import { detectBrowser, isStandaloneApp, openInExternalBrowser, openKakaoExternallyOnce, type BrowserInfo } from '@/lib/in-app-browser';
import { ANDROID_APP, PLAY_STORE_URL } from '@/lib/android-app';
import { InstallSteps, SafariToolbarPointer, installStepsFor } from './InstallSteps';

// 설치 전용 링크(itdot.co.kr/app). 카톡으로 받은 사람이 가장 적게 눌러 홈 화면에 잇닿을 두게 한다.
//  · 카카오톡 안: 열리자마자 사파리·크롬으로 넘긴다 — 카카오톡 안에서는 설치가 안 된다
//  · 안드로이드: 크롬이 설치 창을 허락하면 버튼 한 번, 아직이면(처음 연 사이트는 30초 뒤에 허락) 메뉴 3단계
//  · 아이폰: 사파리 버튼 3~4단계를 그림으로 — 웹에서 설치 창을 띄우는 방법이 없다
//  · 이미 설치한 앱 안에서 열리면 시작 화면으로

const primaryButton = 'flex min-h-14 w-full items-center justify-center rounded-btn bg-primary px-4 text-[16px] font-extrabold text-white shadow-btn active:opacity-80 disabled:opacity-60';

export function AppInstallLanding() {
  const install = usePwaInstall();
  const [info, setInfo] = useState<BrowserInfo | null>(null);
  const [installUrl, setInstallUrl] = useState('https://itdot.co.kr/app');
  const [copied, setCopied] = useState('');
  // 스토어가 열린 뒤에도 스토어 없이 바로 추가하고 싶은 사람을 위해
  const [webInstall, setWebInstall] = useState(false);

  useEffect(() => {
    if (isStandaloneApp()) { window.location.replace('/'); return; }
    const url = `${window.location.origin}/app`;
    setInstallUrl(url);
    const detected = detectBrowser(navigator.userAgent, navigator.maxTouchPoints);
    setInfo(detected);
    if (detected.kakao) openKakaoExternallyOnce(url);
  }, []);

  async function copy() {
    try { await navigator.clipboard.writeText(installUrl); setCopied('주소를 복사했어요. 사파리·크롬 주소창에 붙여 넣어 주세요.'); }
    catch { setCopied('아래 주소를 길게 눌러 복사해 주세요.'); }
  }

  const copyBlock = <div className="mt-3 rounded-2xl bg-bg p-3">
    <p className="select-all break-all text-center text-[13px] font-bold text-ink">{installUrl.replace(/^https?:\/\//, '')}</p>
    <button type="button" onClick={() => void copy()} className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl bg-white text-[13px] font-extrabold text-primary">주소 복사</button>
    {copied && <p role="status" className="mt-2 text-center text-[12px] leading-5 text-sub">{copied}</p>}
  </div>;

  function panel() {
    if (!info) return <div className="h-72 animate-pulse rounded-card bg-bg" aria-label="설치 방법을 확인하고 있어요" />;

    if (info.kakao) return <>
      <h2 className="text-[20px] font-extrabold leading-7 text-ink">{info.ios ? '사파리에서 열고 있어요' : '크롬 같은 브라우저에서 열고 있어요'}</h2>
      <p className="mt-2 text-[14px] leading-6 text-sub">카카오톡 안에서는 앱을 설치할 수 없어서 바깥 브라우저로 넘겼어요. 열린 화면에서 이어서 설치해 주세요.</p>
      <button type="button" onClick={() => openInExternalBrowser(installUrl)} className={`mt-5 ${primaryButton}`}>{info.ios ? '사파리로 열기' : '브라우저로 열기'}</button>
      <p className="mt-3 text-[12px] leading-5 text-sub">그래도 안 열리면 카카오톡 화면의 ⋯ 메뉴에서 <b className="text-ink">다른 브라우저로 열기</b>를 눌러 주세요.</p>
      {copyBlock}
    </>;

    if (info.inApp) return <>
      <h2 className="text-[20px] font-extrabold leading-7 text-ink">{info.ios ? '사파리에서 열어 주세요' : '크롬에서 열어 주세요'}</h2>
      <p className="mt-2 text-[14px] leading-6 text-sub">지금 보고 있는 앱 안에서는 설치할 수 없어요.</p>
      {info.android && <button type="button" onClick={() => openInExternalBrowser(installUrl)} className={`mt-5 ${primaryButton}`}>크롬으로 열기</button>}
      {copyBlock}
    </>;

    if (info.android) {
      if (ANDROID_APP.live && !webInstall) return <>
        <h2 className="text-[20px] font-extrabold leading-7 text-ink">Play 스토어에서 받아요</h2>
        <p className="mt-2 text-[14px] leading-6 text-sub">설치를 누르고, 다 받으면 열기를 누르면 끝이에요.</p>
        <a href={PLAY_STORE_URL} className={`mt-5 ${primaryButton}`}>Play 스토어에서 받기</a>
        <button type="button" onClick={() => setWebInstall(true)} className="mt-2 flex min-h-11 w-full items-center justify-center text-[13px] font-bold text-sub">스토어 없이 바로 추가하기</button>
      </>;
      if (install.installed) return <Done title="✓ 설치했어요" text="홈 화면의 잇닿 아이콘을 눌러 열어 주세요." />;
      if (install.pending) return <Done title="설치하고 있어요" text="홈 화면에 잇닿 아이콘이 생기면 눌러 열어 주세요." />;
      const steps = installStepsFor(info);
      return <>
        <h2 className="text-[20px] font-extrabold leading-7 text-ink">{install.available ? '버튼 한 번이면 설치돼요' : '버튼 세 번이면 설치돼요'}</h2>
        {install.available
          ? <button type="button" disabled={install.busy} onClick={() => void install.install()} className={`mt-5 ${primaryButton}`}>{install.busy ? '설치 창 여는 중…' : '잇닿 설치하기'}</button>
          : steps && <InstallSteps steps={steps} className="mt-4" />}
        {install.error && <p role="alert" className="mt-3 text-[12px] font-bold text-red-600">{install.error}</p>}
        <p className="mt-3 text-[12px] leading-5 text-sub">설치한 앱에서 새 근무 알림을 켤 수 있어요.</p>
      </>;
    }

    if (info.ios) {
      const steps = installStepsFor(info);
      if (!steps) return <>
        <h2 className="text-[20px] font-extrabold leading-7 text-ink">사파리에서 열면 가장 쉬워요</h2>
        <p className="mt-2 text-[14px] leading-6 text-sub">주소를 복사해 사파리 주소창에 붙여 넣어 주세요.</p>
        {copyBlock}
      </>;
      return <>
        <h2 className="text-[20px] font-extrabold leading-7 text-ink">홈 화면에 추가하면 앱처럼 써요</h2>
        <p className="mt-1 text-[14px] leading-6 text-sub">{info.chromeIos ? '크롬' : '사파리'} 버튼을 순서대로 눌러 주세요.</p>
        <InstallSteps steps={steps} className="mt-4" />
        <p className="mt-3 rounded-2xl bg-primary-light px-3 py-2.5 text-[13px] leading-5 text-ink">추가한 <b>잇닿</b> 아이콘을 누르고 카카오로 한 번 로그인하면 끝이에요. 새 근무 알림도 앱에서 켜져요.</p>
      </>;
    }

    return <>
      <h2 className="text-[20px] font-extrabold leading-7 text-ink">휴대폰에서 열어 주세요</h2>
      <p className="mt-2 text-[14px] leading-6 text-sub">잇닿 근무자 앱은 휴대폰 홈 화면에 추가해서 써요. 이 주소를 휴대폰으로 보내 열어 주세요.</p>
      {copyBlock}
    </>;
  }

  return (
    <main className="min-h-screen bg-white px-5 pb-[calc(88px+env(safe-area-inset-bottom))] pt-[max(28px,env(safe-area-inset-top))]">
      <div className="mx-auto max-w-md">
        <header className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" width={56} height={56} className="h-14 w-14 rounded-[16px] shadow-card" />
          <div className="min-w-0">
            <h1 className="text-[22px] font-extrabold leading-7 tracking-[-0.5px] text-ink">잇닿 근무자</h1>
            <p className="text-[13px] leading-5 text-sub">새 근무 알림부터 출근하기·지급 확인까지</p>
          </div>
        </header>
        <section className="mt-6">{panel()}</section>
        <Link href="/" className="mt-5 flex min-h-11 items-center justify-center text-[13px] font-bold text-sub">설치 없이 웹에서 계속하기 →</Link>
      </div>
      {info && !info.kakao && <SafariToolbarPointer info={info} />}
    </main>
  );
}

function Done({ title, text }: { title: string; text: string }) {
  return <div className="rounded-card bg-success-light px-4 py-5 text-center">
    <p className="text-[20px] font-extrabold text-success">{title}</p>
    <p role="status" className="mt-2 text-[14px] leading-6 text-ink">{text}</p>
  </div>;
}
