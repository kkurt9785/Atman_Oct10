'use client';

import QRCode from 'qrcode';
import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

function WorkplaceQrContent() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const params = useSearchParams();
  const attendanceToken=params.get('attendanceToken');

  useEffect(() => {
    if (!attendanceToken || !canvas.current) return;
    const target = `${window.location.origin}/workplace?attendanceToken=${encodeURIComponent(attendanceToken)}`;
    void QRCode.toCanvas(canvas.current, target, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
  }, [attendanceToken]);

  return <main className="min-h-screen bg-white flex items-center justify-center p-4">
    {attendanceToken ? <canvas ref={canvas} aria-label="직원 출퇴근 QR"/> : <p>동적 QR 정보를 확인해 주세요.</p>}
  </main>;
}

export default function WorkplaceQrPage(){
  return <Suspense fallback={<main className="min-h-screen bg-white"/>}><WorkplaceQrContent/></Suspense>;
}
