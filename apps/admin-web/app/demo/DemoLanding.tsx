'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { usePwaInstall } from '@/lib/pwa-install';
import { detectBrowser, isStandaloneApp, openInExternalBrowser, openKakaoExternallyOnce, type BrowserInfo } from '@/lib/in-app-browser';
import { InstallGallery, InstallSteps, SafariToolbarPointer, installStepsFor } from '@/components/install/InstallSteps';

// 관리자 로그인 화면의 '시연 링크 보내기'로 보내는 링크(admin.itdot.co.kr/demo, 단기·행사는 ?kind=gigworker).
// 받은 사장님이 가장 적게 눌러 ① 영상을 보고 ② 관리자 앱을 홈 화면에 두게 한다(2026-11-06 사용자 요청).
//  · 카카오톡 안: 열리자마자 사파리·크롬으로 한 번 넘긴다 — 카카오톡 안에서는 설치가 안 된다(영상은 그대로 보인다)
//  · 안드로이드 크롬: 설치 창이 허락되면 버튼 한 번, 아직이면 메뉴 3단계(영상을 보는 사이 허락되면 버튼으로 바뀐다)
//  · 아이폰: 사파리 버튼 단계를 그림으로 — 웹에서 설치 창을 띄우는 방법이 없다
//  · PC: 휴대폰으로 이어서 열 QR
// 영상은 근무자 사이트(itdot.co.kr/demo/)의 파일을 그대로 쓴다 — 두 곳에 두면 다시 찍을 때 한쪽이 옛 영상으로 남는다.

export type DemoKind = 'hospital' | 'gigworker';

const CONTENT = {
  hospital: {
    title: '잇닿 관리자',
    subtitle: '병원·약국·요양병원 근무 관리',
    video: 'https://itdot.co.kr/demo/itdot-admin-demo.mp4',
    // 영상 첫 장면은 소개 페이지라 누르는 화면처럼 보인다 — 45초의 '지원 현황·대타 요청' 장면을 대표 그림으로(ffmpeg -ss 45 … -vf scale=720:-1 → public/demo/admin-poster.jpg)
    poster: '/demo/admin-poster.jpg',
    videoLabel: '관리자 화면 · 약 1분 35초',
    videoAria: '잇닿 관리자 화면 시연 영상',
    intro: 'https://itdot.co.kr/intro',
  },
  gigworker: {
    title: '잇닿 단기·행사',
    subtitle: '근무자 초대·출퇴근·지급 기록',
    video: 'https://itdot.co.kr/demo/itdot-gig-demo.mp4',
    poster: 'https://itdot.co.kr/demo/itdot-gig-demo-poster.jpg',
    // 단기 사장님 화면 영상은 아직 없다 — 근무자 화면 영상이라고 그대로 밝힌다(itdot.co.kr/intro 와 같은 원칙)
    videoLabel: '근무자 화면 참고 영상 · 약 1분',
    videoAria: '잇닿 단기·행사 근무자 화면 시연 영상',
    intro: 'https://itdot.co.kr/intro?role=admin&kind=gigworker',
  },
} as const;

const primaryButton = 'flex min-h-14 w-full items-center justify-center rounded-xl bg-primary px-4 text-[1rem] font-extrabold text-white shadow-btn active:opacity-80 disabled:opacity-60';

export function DemoLanding({ kind }: { kind: DemoKind }) {
  const content = CONTENT[kind];
  const install = usePwaInstall();
  const [info, setInfo] = useState<BrowserInfo | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [pageUrl, setPageUrl] = useState('');
  const [copied, setCopied] = useState('');
  const qr = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const url = window.location.href;
    setPageUrl(url);
    setStandalone(isStandaloneApp());
    const detected = detectBrowser(navigator.userAgent, navigator.maxTouchPoints);
    setInfo(detected);
    if (detected.kakao) openKakaoExternallyOnce(url);
  }, []);

  const showQr = !!info && !info.ios && !info.android && !info.inApp && !standalone && !install.available && !install.installed && !install.pending;
  useEffect(() => {
    if (!showQr || !pageUrl || !qr.current) return;
    void QRCode.toCanvas(qr.current, pageUrl, { width: 160, margin: 1, color: { dark: '#191F28', light: '#FFFFFF' } }).catch(() => undefined);
  }, [showQr, pageUrl]);

  async function copy() {
    try { await navigator.clipboard.writeText(pageUrl); setCopied('주소를 복사했어요. 사파리·크롬 주소창에 붙여 넣어 주세요.'); }
    catch { setCopied('아래 주소를 길게 눌러 복사해 주세요.'); }
  }

  const copyBlock = <div className="mt-3 rounded-2xl bg-bg p-3">
    <p className="select-all break-all text-center text-[0.8125rem] font-bold text-ink">{pageUrl.replace(/^https?:\/\//, '')}</p>
    <button type="button" onClick={() => void copy()} className="mt-2 flex min-h-11 w-full items-center justify-center rounded-xl bg-white text-[0.8125rem] font-extrabold text-primary">주소 복사</button>
    {copied && <p role="status" className="mt-2 text-center text-[0.75rem] leading-5 text-sub">{copied}</p>}
  </div>;

  const afterInstall = <p className="mt-3 rounded-2xl bg-primary/10 px-3 py-2.5 text-[0.8125rem] leading-5 text-ink">추가한 <b>잇닿 관리자</b> 아이콘을 누르면 로그인 화면이 열려요. 가입 전에는 그 화면의 <b>시연</b> 버튼으로 바로 둘러볼 수 있어요.</p>;

  function panel() {
    if (!info) return <div className="h-40 animate-pulse rounded-2xl bg-bg" aria-label="설치 방법을 확인하고 있어요" />;

    if (standalone) return <Done title="관리자 앱으로 보고 있어요" text="이미 설치돼 있어요. 아래 버튼으로 바로 시연해 보세요." />;

    if (info.kakao) return <>
      <p className="text-[1.0625rem] font-extrabold leading-7 text-ink">{info.ios ? '사파리에서 이어서 설치해요' : '브라우저에서 이어서 설치해요'}</p>
      <p className="mt-1 text-[0.875rem] leading-6 text-sub">카카오톡 안에서는 앱을 설치할 수 없어요. 열린 {info.ios ? '사파리' : '브라우저'} 화면에서 이어서 설치해 주세요.</p>
      <button type="button" onClick={() => openInExternalBrowser(pageUrl)} className={`mt-4 ${primaryButton}`}>{info.ios ? '사파리로 열기' : '브라우저로 열기'}</button>
      <p className="mt-3 text-[0.75rem] leading-5 text-sub">그래도 안 열리면 카카오톡 화면의 ⋯ 메뉴에서 <b className="text-ink">다른 브라우저로 열기</b>를 눌러 주세요.</p>
      {copyBlock}
    </>;

    if (info.inApp) return <>
      <p className="text-[1.0625rem] font-extrabold leading-7 text-ink">{info.ios ? '사파리에서 열어 주세요' : '크롬에서 열어 주세요'}</p>
      <p className="mt-1 text-[0.875rem] leading-6 text-sub">지금 보고 있는 앱 안에서는 설치할 수 없어요.</p>
      {info.android && <button type="button" onClick={() => openInExternalBrowser(pageUrl)} className={`mt-4 ${primaryButton}`}>크롬으로 열기</button>}
      {copyBlock}
    </>;

    if (install.installed) return <Done title="✓ 설치했어요" text="홈 화면의 잇닿 관리자 아이콘을 눌러 열어 주세요." />;
    if (install.pending) return <Done title="설치하고 있어요" text="홈 화면에 잇닿 관리자 아이콘이 생기면 눌러 열어 주세요." />;

    if (install.available) return <>
      <p className="text-[1.0625rem] font-extrabold leading-7 text-ink">버튼 한 번이면 설치돼요</p>
      <button type="button" disabled={install.busy} onClick={() => void install.install()} className={`mt-3 ${primaryButton}`}>{install.busy ? '설치 창 여는 중…' : '관리자 앱 설치하기'}</button>
      {install.error && <p role="alert" className="mt-3 text-[0.75rem] font-bold text-warn">{install.error}</p>}
    </>;

    const steps = installStepsFor(info);
    if (info.android) return <>
      <p className="text-[1.0625rem] font-extrabold leading-7 text-ink">버튼 세 번이면 설치돼요</p>
      {steps && <><InstallSteps steps={steps} className="mt-3" /><InstallGallery steps={steps} className="mt-3" /></>}
      {install.error && <p role="alert" className="mt-3 text-[0.75rem] font-bold text-warn">{install.error}</p>}
      {afterInstall}
    </>;

    if (info.ios) {
      if (!steps) return <>
        <p className="text-[1.0625rem] font-extrabold leading-7 text-ink">사파리에서 열면 가장 쉬워요</p>
        <p className="mt-1 text-[0.875rem] leading-6 text-sub">주소를 복사해 사파리 주소창에 붙여 넣어 주세요.</p>
        {copyBlock}
      </>;
      return <>
        <p className="text-[1.0625rem] font-extrabold leading-7 text-ink">홈 화면에 추가하면 앱처럼 써요</p>
        <p className="mt-1 text-[0.875rem] leading-6 text-sub">{info.chromeIos ? '크롬' : '사파리'} 버튼을 순서대로 눌러 주세요.</p>
        {/* 영상이 첫 화면의 절반을 차지하므로 단계 목록을 먼저, 그림 띠는 그 아래(1단계가 첫 화면 안에 남게) */}
        <InstallSteps steps={steps} className="mt-3" />
        <InstallGallery steps={steps} className="mt-3" />
        {afterInstall}
      </>;
    }

    return <div className="flex items-center gap-4 rounded-2xl bg-bg p-4">
      <canvas ref={qr} aria-label="휴대폰으로 이 화면을 여는 QR 코드" className="h-36 w-36 shrink-0 rounded-xl bg-white" />
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-extrabold text-ink">휴대폰으로 이어서 설치해요</p>
        <p className="mt-1 text-[0.8125rem] leading-5 text-sub">휴대폰 카메라로 찍으면 같은 화면이 열려요. 거기서 홈 화면에 추가하면 돼요.</p>
      </div>
    </div>;
  }

  return (
    <main className="min-h-screen bg-white px-5 pb-[calc(88px+env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
      <div className="mx-auto max-w-md">
        <header className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" width={48} height={48} className="h-12 w-12 rounded-[14px] shadow-card" />
          <div className="min-w-0">
            <h1 className="text-[1.25rem] font-extrabold leading-7 tracking-[-0.5px] text-ink">{content.title}</h1>
            <p className="text-[0.8125rem] leading-5 text-sub">{content.subtitle}</p>
          </div>
        </header>

        <section className="mt-5" aria-labelledby="demo-video-title">
          <h2 id="demo-video-title" className="flex items-center gap-2 text-[0.9375rem] font-extrabold text-ink"><Num n={1} />영상으로 먼저 보기</h2>
          <div className="mt-2 flex justify-center overflow-hidden rounded-2xl bg-black">
            {/* 세로 영상이 화면을 다 덮으면 설치 단계가 아래로 밀린다 — 높이를 화면의 절반으로 묶는다(375×667 에서 설치 1단계까지 첫 화면) */}
            <video className="block aspect-[9/16] h-[min(50vh,520px)] max-w-full bg-black" controls playsInline preload="metadata" poster={content.poster} aria-label={content.videoAria}>
              <source src={content.video} type="video/mp4" />
              이 브라우저에서는 영상을 재생할 수 없어요.
            </video>
          </div>
          <p className="mt-1.5 text-center text-[0.75rem] text-tertiary">{content.videoLabel} · 소리를 켜면 더 쉬워요</p>
        </section>

        <section className="mt-6" aria-labelledby="demo-install-title">
          <h2 id="demo-install-title" className="flex items-center gap-2 text-[0.9375rem] font-extrabold text-ink"><Num n={2} />관리자 앱 설치</h2>
          <div className="mt-3">{panel()}</div>
        </section>

        <a href={`/login?demo=${kind}`} className="mt-6 flex min-h-12 w-full items-center justify-center rounded-xl border border-line text-[0.875rem] font-bold text-primary active:bg-bg">설치 없이 바로 눌러 보기 →</a>
        <p className="mt-2 text-center text-[0.6875rem] leading-4 text-sub">공용 시연 계정이에요. 실제 개인정보는 입력하지 마세요.</p>
        <a href={content.intro} className="mb-10 mt-3 flex min-h-11 items-center justify-center text-[0.8125rem] font-bold text-sub">자세한 소개 보기</a>
      </div>
      {info && !info.kakao && !standalone && !install.installed && <SafariToolbarPointer info={info} />}
    </main>
  );
}

function Num({ n }: { n: number }) {
  return <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[0.75rem] font-extrabold text-white">{n}</span>;
}

function Done({ title, text }: { title: string; text: string }) {
  return <div className="rounded-2xl bg-success/10 px-4 py-5 text-center">
    <p className="text-[1.125rem] font-extrabold text-success">{title}</p>
    <p role="status" className="mt-2 text-[0.875rem] leading-6 text-ink">{text}</p>
  </div>;
}
