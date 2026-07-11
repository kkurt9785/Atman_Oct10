'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '@/lib/supabase';

type Props = {
  applicationId: string;
  shiftDate: string;
  startTime: string;
  facilityName?: string;
  onClose: () => void;
};

type QrState = {
  token: string;
  expiresAt: Date;
};

export function QRModal({ applicationId, shiftDate, startTime, facilityName, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qr, setQr] = useState<QrState | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const issue = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('issue_attendance_qr', {
      p_application_id: applicationId,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (rpcError || !row?.token || !row?.expires_at) {
      setQr(null);
      setError(rpcError?.message?.replace(/^.*?: /, '') ?? 'QR을 발급하지 못했어요.');
      setLoading(false);
      return;
    }
    setQr({ token: row.token as string, expiresAt: new Date(row.expires_at as string) });
    setLoading(false);
  }, [applicationId]);

  useEffect(() => { void issue(); }, [issue]);

  useEffect(() => {
    if (!qr || !canvasRef.current) return;
    const payload = JSON.stringify({ type: 'attendance_challenge', token: qr.token });
    void QRCode.toCanvas(canvasRef.current, payload, {
      width: 240,
      margin: 2,
      color: { dark: '#191F28', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    });
  }, [qr]);

  useEffect(() => {
    if (!qr) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((qr.expiresAt.getTime() - Date.now()) / 1000));
      setSeconds(remaining);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [qr]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6" onClick={onClose}>
      <div className="bg-white rounded-[24px] p-7 w-full max-w-sm flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[20px] font-extrabold text-ink mb-1">일회용 출퇴근 QR</h2>
        <p className="text-[13px] text-sub mb-1">{shiftDate} · {startTime.slice(0, 5)}</p>
        {facilityName && <p className="text-[13px] font-semibold text-primary mb-5">{facilityName}</p>}

        {loading ? (
          <div className="w-[240px] h-[240px] rounded-xl bg-bg flex items-center justify-center mb-5">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="w-full min-h-[180px] rounded-xl bg-red-50 px-5 flex flex-col items-center justify-center text-center mb-5">
            <p className="text-[14px] font-bold text-red-600 break-keep">{error}</p>
            <button type="button" onClick={() => void issue()} className="mt-4 px-4 py-2 rounded-xl bg-primary text-white text-[13px] font-bold">다시 발급</button>
          </div>
        ) : (
          <>
            <canvas ref={canvasRef} className={`rounded-xl mb-3 ${seconds === 0 ? 'opacity-30' : ''}`} />
            <p className={`text-[15px] font-extrabold mb-3 ${seconds <= 10 ? 'text-red-500' : 'text-primary'}`}>
              {seconds > 0 ? `${seconds}초 후 만료` : '만료됨'}
            </p>
            {seconds === 0 && (
              <button type="button" onClick={() => void issue()} className="mb-4 px-5 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold">새 QR 발급</button>
            )}
          </>
        )}

        <p className="text-[12px] text-tertiary text-center mb-6">
          담당자에게 이 QR을 스캔받으세요.<br />QR은 60초 동안 한 번만 사용할 수 있어요.
        </p>
        <button type="button" onClick={onClose} className="w-full h-12 bg-primary text-white font-bold rounded-2xl active:opacity-80">닫기</button>
      </div>
    </div>
  );
}
