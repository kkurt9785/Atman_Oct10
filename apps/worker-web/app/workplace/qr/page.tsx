'use client';

import QRCode from 'qrcode';
import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BackButton } from '@/components/BackButton';

function WorkplaceQrContent() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const params = useSearchParams();
  const attendanceToken=params.get('attendanceToken');

  useEffect(() => {
    if (!attendanceToken || !canvas.current) return;
    const target = `${window.location.origin}/workplace?attendanceToken=${encodeURIComponent(attendanceToken)}`;
    void QRCode.toCanvas(canvas.current, target, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
  }, [attendanceToken]);

  // 설치 앱엔 브라우저 뒤로가기가 없다 — 화면 안 뒤로 버튼과 돌아갈 길을 둔다
  return <main className="min-h-screen bg-white px-4 pb-10 pt-4">
    <BackButton href="/workplace" label="출퇴근" anyPrevious />
    <h1 className="mt-3 text-[22px] font-extrabold text-ink">출퇴근 QR</h1>
    <div className="mt-6 flex flex-col items-center justify-center text-center">
      {attendanceToken
        ? <canvas ref={canvas} aria-label="직원 출퇴근 QR"/>
        : <>
            <p className="text-[15px] font-bold text-ink">QR 정보가 없어요</p>
            <p className="mt-2 text-[13px] leading-5 text-sub">사업장 화면의 동적 QR을 다시 스캔하거나, 출퇴근 화면에서 위치로 출근해 주세요.</p>
            <Link href="/workplace" className="mt-4 inline-flex h-11 items-center rounded-xl bg-primary px-5 text-[14px] font-extrabold text-white">출퇴근 화면으로</Link>
          </>}
    </div>
  </main>;
}

export default function WorkplaceQrPage(){
  return <Suspense fallback={<main className="min-h-screen bg-white"/>}><WorkplaceQrContent/></Suspense>;
}
