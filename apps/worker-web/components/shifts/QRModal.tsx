'use client';

import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

type Props = {
  applicationId: string;
  shiftDate: string;
  startTime: string;
  facilityName?: string;
  onClose: () => void;
};

export function QRModal({ applicationId, shiftDate, startTime, facilityName, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, JSON.stringify({
      type: 'shift_application',
      applicationId,
      issuedAt: new Date().toISOString(),
    }), {
      width: 240,
      margin: 2,
      color: { dark: '#191F28', light: '#FFFFFF' },
    });
  }, [applicationId]);

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

        <canvas ref={canvasRef} className="rounded-xl mb-5" />

        <p className="text-[12px] text-tertiary text-center mb-6">
          담당자에게 이 QR을 스캔받으세요<br />당일에만 유효해요
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
