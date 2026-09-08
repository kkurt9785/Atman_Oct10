'use client';

import QRCode from 'qrcode';
import { useEffect, useRef } from 'react';

// 관리자 앱이 직접 그리는 QR. 워커 앱 페이지를 iframe으로 끼우던 방식은 워커 앱의 X-Frame-Options: DENY에 막혀
// 프로덕션에서 한 번도 렌더되지 않았다. 값만 같으면(워커 /workplace?attendanceToken=…) 스캔 결과는 동일하다.
export function QrCanvas({ value, size = 280, label = 'QR' }: { value: string; size?: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    void QRCode.toCanvas(ref.current, value, { width: size, margin: 2, errorCorrectionLevel: 'M' });
  }, [value, size]);
  return <canvas ref={ref} aria-label={label} className="mx-auto block rounded-xl bg-white" />;
}
