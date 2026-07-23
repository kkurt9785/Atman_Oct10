'use client';

import QRCode from 'qrcode';
import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

function WorkplaceQrContent() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const params = useSearchParams();
  const token = params.get('token');

  useEffect(() => {
    if (!token || !canvas.current) return;
    const target = `${window.location.origin}/workplace?token=${encodeURIComponent(token)}`;
    void QRCode.toCanvas(canvas.current, target, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
  }, [token]);

  return <main className="min-h-screen bg-white flex items-center justify-center p-4">
    {token ? <canvas ref={canvas} aria-label="직원 출퇴근 QR"/> : <p>QR 정보를 확인해 주세요.</p>}
  </main>;
}

export default function WorkplaceQrPage(){
  return <Suspense fallback={<main className="min-h-screen bg-white"/>}><WorkplaceQrContent/></Suspense>;
}
