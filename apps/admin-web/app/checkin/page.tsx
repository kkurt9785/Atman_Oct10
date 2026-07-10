'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { recordCheckin, type CheckinResult } from './actions';

type ScanState = 'scanning' | 'loading' | 'success' | 'error';

export default function CheckinPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const [state, setState] = useState<ScanState>('scanning');
  const [result, setResult] = useState<Extract<CheckinResult, { ok: true }> | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // 지오펜스용 스캔 기기 위치 — 카메라 켜는 동안 백그라운드로 확보
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { coordsRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
    );
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          tick();
        }
      } catch {
        setErrorMsg('카메라 접근 권한이 필요해요');
        setState('error');
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) {
        cancelAnimationFrame(animRef.current);
        stream?.getTracks().forEach((t) => t.stop());
        handleScan(code.data);
      } else {
        animRef.current = requestAnimationFrame(tick);
      }
    }

    startCamera();
    return () => {
      cancelAnimationFrame(animRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function handleScan(applicationId: string) {
    setState('loading');
    let scannedApplicationId = applicationId;
    try {
      const payload = JSON.parse(applicationId) as { applicationId?: string };
      if (payload.applicationId) scannedApplicationId = payload.applicationId;
    } catch {
      // Backward compatible with older QR codes that contain only applicationId.
    }
    const res = await recordCheckin(scannedApplicationId, coordsRef.current);
    if (res.ok) {
      setResult(res);
      setState('success');
    } else {
      setErrorMsg(res.message);
      setState('error');
    }
  }

  function reset() {
    setState('scanning');
    setResult(null);
    setErrorMsg('');
    window.location.reload();
  }

  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      {state === 'scanning' && (
        <>
          <p className="text-white text-[17px] font-bold mb-6">QR 스캔</p>
          <div className="relative w-72 h-72 rounded-2xl overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 border-4 border-primary rounded-2xl pointer-events-none" />
            <div className="absolute top-2 left-2 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-xl" />
            <div className="absolute top-2 right-2 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-xl" />
            <div className="absolute bottom-2 left-2 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-xl" />
            <div className="absolute bottom-2 right-2 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-xl" />
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <p className="text-white/60 text-[14px] mt-6">워커 QR 코드를 화면에 맞춰주세요</p>
        </>
      )}

      {state === 'loading' && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-white text-[15px]">확인 중...</p>
        </div>
      )}

      {state === 'success' && result && (
        <div className="bg-white rounded-3xl p-8 w-full max-w-sm flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-[#E5FAF4] flex items-center justify-center mb-4">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M7 16L13 22L25 10" stroke="#00C896" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="text-[22px] font-extrabold text-ink mb-1">
            {result.action === 'checkin' ? '체크인 완료!' : '체크아웃 완료!'}
          </h2>
          <p className="text-[17px] font-bold text-primary mb-1">{result.workerName}</p>
          <p className="text-[14px] text-sub">{result.shiftDate} · {result.startTime.slice(0, 5)}</p>
          {result.action === 'checkout' && result.gross && (
            <p className="text-[20px] font-extrabold text-ink mt-2">
              ₩{result.gross.toLocaleString('ko-KR')}
            </p>
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
          <p className="text-[14px] text-sub text-center">{errorMsg}</p>
          <button onClick={reset} className="mt-8 w-full bg-primary text-white font-bold rounded-2xl py-4 active:opacity-80">
            다시 시도
          </button>
        </div>
      )}
    </main>
  );
}
