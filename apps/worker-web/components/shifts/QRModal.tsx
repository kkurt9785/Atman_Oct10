'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';

type Props = {
  applicationId: string;
  shiftDate: string;
  startTime: string;
  facilityName?: string;
  onClose: () => void;
};

const REFRESH_SECONDS = 45; // 토큰 TTL(60s)보다 짧게 회전 — 스크린샷 재사용 차단

export function QRModal({ applicationId, shiftDate, startTime, facilityName, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [remain, setRemain] = useState(REFRESH_SECONDS);
  const [error, setError] = useState('');

  const issueAndRender = useCallback(async () => {
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setError('로그인이 만료됐어요. 다시 로그인해주세요.');
      return;
    }
    const res = await fetch('/api/qr-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ applicationId }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.token) {
      setError(data?.error ?? 'QR 생성에 실패했어요. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, data.token, {
        width: 240,
        margin: 2,
        color: { dark: '#191F28', light: '#FFFFFF' },
      });
    }
    setRemain(REFRESH_SECONDS);
  }, [applicationId]);

  // 최초 발급 + 45초마다 회전
  useEffect(() => {
    issueAndRender();
    const rotate = setInterval(issueAndRender, REFRESH_SECONDS * 1000);
    return () => clearInterval(rotate);
  }, [issueAndRender]);

  // 남은 시간 카운트다운
  useEffect(() => {
    const tick = setInterval(() => setRemain((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6" onClick={onClose}>
      <div
        className="bg-white rounded-[24px] p-7 w-full max-w-sm flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[20px] font-extrabold text-ink mb-1">QR 체크인</h2>
        <p className="text-[13px] text-sub mb-1">{shiftDate} · {startTime.slice(0, 5)}</p>
        {facilityName && (
          <p className="text-[13px] font-semibold text-primary mb-5">{facilityName}</p>
        )}

        {error ? (
          <div className="h-[240px] w-[240px] rounded-xl bg-bg flex flex-col items-center justify-center gap-3 mb-5 px-4">
            <p className="text-[13px] font-bold text-red-500 text-center">{error}</p>
            <button onClick={issueAndRender} className="text-[13px] font-bold text-primary underline">
              다시 시도
            </button>
          </div>
        ) : (
          <canvas ref={canvasRef} className="rounded-xl mb-5" />
        )}

        <p className="text-[12px] text-tertiary text-center mb-1">
          담당자에게 이 QR을 스캔받으세요
        </p>
        <p className="text-[12px] font-semibold text-primary mb-6">
          {remain}초 후 자동 갱신 · 캡처본은 사용할 수 없어요
        </p>

        <button
          onClick={onClose}
          className="w-full h-12 bg-primary text-white font-bold rounded-2xl active:opacity-80"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
