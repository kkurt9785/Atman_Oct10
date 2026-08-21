'use client';

import { useState, useTransition } from 'react';
import { anchorLiveDemoLocationAction } from './actions';

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 기기에서는 위치 정보를 사용할 수 없어요.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
  });
}

export function LiveDemoLocationButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function anchorLocation() {
    setError('');
    setMessage('관리자 현재 위치를 확인하고 있어요…');
    void currentPosition().then((position) => {
      startTransition(async () => {
        try {
          const result = await anchorLiveDemoLocationAction({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
          });
          setMessage(`시연 시설 위치를 현재 위치로 맞췄어요 · GPS ${result.radiusM}m / QR 보완`);
        } catch (cause) {
          setMessage('');
          setError(cause instanceof Error ? cause.message : '시연 위치를 저장하지 못했어요.');
        }
      });
    }).catch((cause: GeolocationPositionError | Error) => {
      setMessage('');
      const code = (cause as GeolocationPositionError).code;
      setError(code === 1
        ? '위치 권한을 허용해 주세요. 아이폰은 Safari 설정 또는 홈 화면 앱의 위치 권한을 확인하면 됩니다.'
        : code === 3 ? '위치 확인 시간이 초과됐어요. 창가나 실외에서 다시 시도해 주세요.'
          : cause instanceof Error ? cause.message : '현재 위치를 확인하지 못했어요.');
    });
  }

  return <div className="mt-3">
    <button type="button" onClick={anchorLocation} disabled={pending} className="min-h-11 w-full rounded-xl border border-violet-300 bg-white px-4 text-[13px] font-extrabold text-violet-700 disabled:opacity-50">
      {pending ? '시연 위치 저장 중…' : '관리자 현재 위치로 GPS 시연 준비'}
    </button>
    {message && <p role="status" className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-[12px] font-bold text-violet-800">{message}</p>}
    {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[12px] font-bold leading-5 text-red-600">{error}</p>}
  </div>;
}
