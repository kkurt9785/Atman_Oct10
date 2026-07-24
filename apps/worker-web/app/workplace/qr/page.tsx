'use client';

import QRCode from 'qrcode';
import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

function WorkplaceQrContent() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const params = useSearchParams();
  const token = params.get('token');
  const attendanceToken=params.get('attendanceToken');

  useEffect(() => {
    const value=attendanceToken??token;
    if (!value || !canvas.current) return;
    const target = attendanceToken
      ? `${window.location.origin}/workplace?attendanceToken=${encodeURIComponent(attendanceToken)}`
      : `${window.location.origin}/workplace?token=${encodeURIComponent(value)}`;
    void QRCode.toCanvas(canvas.current, target, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
  }, [token,attendanceToken]);

  return <main className="min-h-screen bg-white flex items-center justify-center p-4">
    {token||attendanceToken ? <canvas ref={canvas} aria-label="직원 출퇴근 QR"/> : <p>QR 정보를 확인해 주세요.</p>}
  </main>;
}

export default function WorkplaceQrPage(){
  return <Suspense fallback={<main className="min-h-screen bg-white"/>}><WorkplaceQrContent/></Suspense>;
}
