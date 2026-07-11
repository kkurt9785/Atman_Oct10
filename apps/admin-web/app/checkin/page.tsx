
'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { recordCheckin, type CheckinResult } from './actions';

type ScanState = 'scanning' | 'loading' | 'success' | 'error';
type AttendanceQrPayload = { type: 'attendance_challenge'; token: string };

function readPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 30_000 },
    );
  });
}

function parseQr(raw: string): AttendanceQrPayload | null {
  try {
    const value = JSON.parse(raw) as Partial<AttendanceQrPayload>;
    if (
      value.type !== 'attendance_challenge'
      || typeof value.token !== 'string'
      || value.token.length < 32
    ) return null;
    return { type: 'attendance_challenge', token: value.token };
  } catch {
    return null;
  }
}

export default function CheckinPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const handledRef = useRef(false);
  const [state, setState] = useState<ScanState>('scanning');
  const [result, setResult] = useState<Extract<CheckinResult, { ok: true }> | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    void readPosition().then((position) => { coordsRef.current = position; });
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        tick();
      } catch {
        setErrorMsg('카메라 접근 권한이 필요해요. 브라우저 설정을 확인해 주세요.');
        setState('error');
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (stopped || handledRef.current) return;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code?.data) {
        const payload = parseQr(code.data);
        if (!payload) {
          handledRef.current = true;
          stream?.getTracks().forEach((track) => track.stop());
          setErrorMsg('이전 형식이거나 유효하지 않은 QR이에요. 워커 앱에서 QR을 새로 열어 주세요.');
          setState('error');
          return;
        }
        handledRef.current = true;
        stream?.getTracks().forEach((track) => track.stop());
        void handleScan(payload.token);
        return;
      }

      animRef.current = requestAnimationFrame(tick);
    }

    void startCamera();
    return () => {
      stopped = true;
      cancelAnimationFrame(animRef.current);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function handleScan(token: string) {
    setState('loading');
    const coords = coordsRef.current ?? await readPosition();
    coordsRef.current = coords;
    const response = await recordCheckin(token, coords);
    if (response.ok) {
      setResult(response);
      setState('success');
    } else {
      setErrorMsg(response.message);
      setState('error');
    }
  }

  function reset() {
    window.location.reload();
  }

  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      {state === 'scanning' && (
        <>
          <p className="text-white text-[17px] font-bold mb-6">일회용 QR 스캔</p>
          <div className="relative w-72 h-72 rounded-2xl overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 border-4 border-primary rounded-2xl pointer-events-none" />
            <div className="absolute top-2 left-2 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl" />
            <div className="absolute top-2 right-2 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl" />
            <div className="absolute bottom-2 left-2 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl" />
            <div className="absolute bottom-2 right-2 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl" />
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <p className="text-white/60 text-[14px] mt-6 text-center">
            워커 앱에서 방금 발급한 QR을 스캔해 주세요.<br />QR은 60초 후 만료되고 한 번만 사용할 수 있어요.
          </p>
        </>
      )}

      {state === 'loading' && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-white text-[15px]">권한·위치·정산을 확인 중...</p>
        </div>
      )}

      {state === 'success' && result && (
        <div className="bg-white rounded-3xl p-8 w-full max-w-sm flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-[#E5FAF4] flex items-center justify-center mb-4">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M7 16L13 22L25 10" stroke="#00C896" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-[22px] font-extrabold text-ink mb-1">
            {result.action === 'checkin' ? '체크인 완료!' : '체크아웃·정산 등록 완료!'}
          </h2>
          <p className="text-[17px] font-bold text-primary mb-1">{result.workerName}</p>
          <p className="text-[14px] text-sub">{result.shiftDate} · {result.startTime.slice(0, 5)}</p>
          {result.action === 'checkout' && typeof result.gross === 'number' && (
            <div className="mt-4 w-full rounded-2xl bg-bg p-4 text-[13px] space-y-2">
              <div className="flex justify-between"><span className="text-sub">총 임금</span><b>₩{result.gross.toLocaleString('ko-KR')}</b></div>
              {typeof result.platformFee === 'number' && <div className="flex justify-between"><span className="text-sub">플랫폼 수수료</span><b>₩{result.platformFee.toLocaleString('ko-KR')}</b></div>}
              {typeof result.charged === 'number' && <div className="flex justify-between border-t border-line pt-2"><span className="text-ink font-bold">총 차감</span><b className="text-primary">₩{result.charged.toLocaleString('ko-KR')}</b></div>}
              {typeof result.balance === 'number' && <div className="flex justify-between"><span className="text-sub">잔여 크레딧</span><b>₩{result.balance.toLocaleString('ko-KR')}</b></div>}
            </div>
          )}
          <button onClick={reset} className="mt-8 w-full bg-primary text-white font-bold rounded-2xl py-4 active:opacity-80">
            다음 스캔
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className="bg-white rounded-3xl p-8 w-full max-w-sm flex flex-col items-center">
          <span className="text-5xl mb-4">⚠️</span>
          <h2 className="text-[20px] font-extrabold text-ink mb-2">스캔 실패</h2>
          <p className="text-[14px] text-sub text-center break-keep">{errorMsg}</p>
          <button onClick={reset} className="mt-8 w-full bg-primary text-white font-bold rounded-2xl py-4 active:opacity-80">
            다시 시도
          </button>
        </div>
      )}
    </main>
  );
}
