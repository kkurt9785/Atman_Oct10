'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

const DEMO_URL = 'https://admin.itdot.co.kr/login';

export function DemoShareCard() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, DEMO_URL, {
      width: 144,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#191F28', light: '#FFFFFF' },
    });
  }, []);

  async function shareDemo() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: '잇닿 관리자 데모',
          text: '병원·약국·요양병원 관리자 데모를 바로 체험해 보세요.',
          url: DEMO_URL,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(DEMO_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('아래 데모 주소를 복사해 주세요.', DEMO_URL);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-line bg-white p-4">
      <div className="hidden items-center gap-4 md:flex">
        <canvas
          ref={canvasRef}
          aria-label="잇닿 관리자 데모 접속 QR 코드"
          className="h-36 w-36 shrink-0 rounded-xl"
        />
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold text-ink">휴대폰으로 시연해 보세요</p>
          <p className="mt-1 text-[13px] leading-5 text-sub">
            카메라로 찍으면 이 데모 선택 화면이 바로 열려요.
          </p>
          <button
            type="button"
            onClick={shareDemo}
            className="mt-3 h-10 rounded-xl bg-bg px-4 text-[13px] font-bold text-primary active:opacity-70"
          >
            {copied ? '링크를 복사했어요' : '링크 복사'}
          </button>
        </div>
      </div>

      <div className="md:hidden">
        <p className="text-[14px] font-extrabold text-ink">다른 분과 함께 볼까요?</p>
        <p className="mt-1 text-[12px] leading-5 text-sub">데모 선택 화면을 바로 공유할 수 있어요.</p>
        <button
          type="button"
          onClick={shareDemo}
          className="mt-3 h-11 w-full rounded-xl border border-primary/20 bg-primary-light text-[14px] font-bold text-primary active:opacity-70"
        >
          {copied ? '링크를 복사했어요' : '데모 링크 공유'}
        </button>
      </div>
    </div>
  );
}
