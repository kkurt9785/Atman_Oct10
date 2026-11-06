'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';

// 받는 사장님이 링크 하나로 ① 영상을 보고 ② 관리자 앱을 바로 설치하게 /demo 로 보낸다(2026-11-06 사용자 요청).
// 고르는 화면이 있는 소개(itdot.co.kr/intro)는 /demo 아래 '자세한 소개 보기'로 이어진다.
const LINKS = {
  hospital: {
    label: '병원·약국·요양병원',
    url: 'https://admin.itdot.co.kr/demo',
    text: '잇닿 관리자 앱 — 1분 영상으로 먼저 보고, 눌러서 바로 설치해요.',
    mobile: '시연 영상과 관리자 앱 설치를 한 링크로 보내요.',
  },
  gigworker: {
    label: '단기·행사 사장님용',
    url: 'https://admin.itdot.co.kr/demo?kind=gigworker',
    text: '팝업·행사·단기 근무 관리 — 1분 영상으로 먼저 보고, 눌러서 바로 설치해요.',
    mobile: '단기·행사 시연 영상과 관리자 앱 설치를 한 링크로 보내요.',
  },
} as const;
type LinkKind = keyof typeof LINKS;

export function DemoShareCard() {
  const searchParams = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  // 단기 영업 링크(/login?mode=gigworker)로 들어왔으면 단기·행사 링크를 먼저 골라 둔다
  const [kind, setKind] = useState<LinkKind>(searchParams.get('mode') === 'gigworker' ? 'gigworker' : 'hospital');
  const link = LINKS[kind];

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, link.url, {
      width: 144,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#191F28', light: '#FFFFFF' },
    });
  }, [link.url]);

  async function shareDemo() {
    if (navigator.share) {
      try {
        await navigator.share({ title: '잇닿 시연', text: link.text, url: link.url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('아래 데모 주소를 복사해 주세요.', link.url);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-line bg-white p-4">
      <div className="mb-3 grid grid-cols-2 gap-2" role="group" aria-label="보낼 시연 링크 고르기">
        {(Object.keys(LINKS) as LinkKind[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={kind === key}
            onClick={() => { setKind(key); setCopied(false); }}
            className={`min-h-11 rounded-xl px-2 text-[0.8125rem] font-bold ${kind === key ? 'bg-primary text-white' : 'border border-line bg-white text-sub'}`}
          >
            {LINKS[key].label}
          </button>
        ))}
      </div>

      <div className="hidden items-center gap-4 md:flex">
        <canvas
          ref={canvasRef}
          aria-label={`잇닿 시연 접속 QR 코드 · ${link.label}`}
          className="h-36 w-36 shrink-0 rounded-xl"
        />
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-extrabold text-ink">휴대폰으로 시연해 보세요</p>
          <p className="mt-1 text-[0.8125rem] leading-5 text-sub">
            카메라로 찍으면 시연 영상을 보고 관리자 앱을 바로 설치할 수 있어요.
          </p>
          <button
            type="button"
            onClick={shareDemo}
            className="mt-3 h-10 rounded-xl bg-bg px-4 text-[0.8125rem] font-bold text-primary active:opacity-70"
          >
            {copied ? '링크를 복사했어요' : '링크 복사'}
          </button>
        </div>
      </div>

      <div className="md:hidden">
        <p className="text-[0.875rem] font-extrabold text-ink">다른 분과 함께 볼까요?</p>
        <p className="mt-1 text-[0.75rem] leading-5 text-sub">{link.mobile}</p>
        <button
          type="button"
          onClick={shareDemo}
          className="mt-3 h-11 w-full rounded-xl border border-primary/20 bg-primary/10 text-[0.875rem] font-bold text-primary active:opacity-70"
        >
          {copied ? '링크를 복사했어요' : '시연 링크 보내기'}
        </button>
      </div>
      <p className="mt-2 break-all text-center text-[0.6875rem] text-tertiary">{link.url.replace('https://', '')}</p>
    </div>
  );
}
