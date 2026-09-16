'use client';

import { useEffect, useRef, useState } from 'react';

declare global { interface Window { kakao?: any } }

// 사업장 위치 핀 조정 지도. 심평원/카카오 좌표는 건물 대표점이라 입구 기준으로 드래그해 맞춘다.
// radiusMeters는 출퇴근 인증 반경 미리보기(원)로만 쓰고, 값 자체는 시설 프로필에서 관리한다.
export function FacilityPinMap({ lng, lat, radiusMeters = 100, onChange, className }: {
  lng: number; lat: number; radiusMeters?: number;
  onChange: (next: { lng: number; lat: number }) => void; className?: string;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
    if (!key) { setError('지도 키가 설정되지 않았어요.'); return; }
    function draw() {
      if (!window.kakao?.maps?.load) { setError('지도를 불러오지 못했어요. 검색된 위치로 등록되고, 위치는 나중에 설정에서 옮길 수 있어요.'); return; }
      window.kakao.maps.load(() => {
        try {
        if (!mapEl.current || mapRef.current) return;
        const center = new window.kakao.maps.LatLng(lat, lng);
        const map = new window.kakao.maps.Map(mapEl.current, { center, level: 2 }); // 30m 원이 보이도록 확대
        const marker = new window.kakao.maps.Marker({ map, position: center, draggable: true });
        const circle = new window.kakao.maps.Circle({ map, center, radius: radiusMeters, strokeWeight: 1, strokeColor: '#3182F6', strokeOpacity: 0.8, fillColor: '#3182F6', fillOpacity: 0.12 });
        window.kakao.maps.event.addListener(marker, 'dragend', () => {
          const p = marker.getPosition();
          circle.setPosition(p);
          onChange({ lng: p.getLng(), lat: p.getLat() });
        });
        // 지도를 탭해도 핀이 옮겨지게 — 드래그가 어려운 모바일 배려
        window.kakao.maps.event.addListener(map, 'click', (e: any) => {
          const p = e.latLng; marker.setPosition(p); circle.setPosition(p);
          onChange({ lng: p.getLng(), lat: p.getLat() });
        });
        mapRef.current = map; markerRef.current = marker; circleRef.current = circle;
        } catch (e) { console.error('[FacilityPinMap]', e); setError('지도를 불러오지 못했어요. 검색된 위치로 등록되고, 위치는 나중에 설정에서 옮길 수 있어요.'); }
      });
    }
    if (window.kakao?.maps) { draw(); return; }
    const existing = document.querySelector<HTMLScriptElement>('script[data-atman-kakao-map]');
    if (existing) { existing.addEventListener('load', draw); return; }
    const script = document.createElement('script');
    script.dataset.atmanKakaoMap = 'true';
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.async = true; script.onload = draw; script.onerror = () => setError('지도를 불러오지 못했어요.');
    document.head.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 외부에서 좌표가 바뀌면(검색 결과 재선택) 핀·원·중심을 옮긴다
  useEffect(() => {
    if (!mapRef.current || !window.kakao?.maps) return;
    const p = new window.kakao.maps.LatLng(lat, lng);
    markerRef.current?.setPosition(p); circleRef.current?.setPosition(p); mapRef.current.panTo(p);
  }, [lng, lat]);

  useEffect(() => { circleRef.current?.setRadius(radiusMeters); }, [radiusMeters]);

  return (
    <div className={className}>
      <div ref={mapEl} className="h-56 w-full rounded-xl bg-[#E8EDF2]" aria-label="사업장 위치 지도" />
      <CurrentLocationButton className="mt-2" radiusMeters={radiusMeters} onChange={onChange} />
      {error ? <p role="alert" className="mt-2 text-[12px] text-warn">{error}</p>
        : <p className="mt-2 text-[12px] text-sub">사업장 안에서 위 버튼을 누르면 가장 정확해요. 핀을 끌거나 지도를 탭해 <b>출입구 위치</b>로 맞춰도 됩니다. 원은 출퇴근 인증 반경 미리보기예요.</p>}
    </div>
  );
}

// 주소를 받아 핀을 찾아 옮기는 대신, 사업장에 서 있는 관리자의 현재 위치를 그대로
// 사업장 좌표로 삼는다. 출퇴근 인증이 대조하는 값도 같은 GPS라 서로 어긋날 일이 없다.
// 다만 실내에서는 오차가 커지므로, 오차가 인증 반경보다 크면 그대로 쓰지 말라고 알린다.
export function CurrentLocationButton({ radiusMeters = 30, onChange, className, label = '지금 있는 곳을 사업장으로' }: {
  radiusMeters?: number;
  onChange: (next: { lng: number; lat: number }) => void;
  className?: string;
  label?: string;
}) {
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState('');

  function capture() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNote('이 브라우저에서는 현재 위치를 쓸 수 없어요. 지도를 탭해 지정해 주세요.');
      return;
    }
    setLocating(true); setNote('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude, accuracy } = pos.coords;
        onChange({ lng: longitude, lat: latitude });
        const rounded = Math.round(accuracy);
        setNote(
          rounded > radiusMeters
            ? `위치를 가져왔지만 오차가 약 ${rounded}m로 인증 반경(${radiusMeters}m)보다 큽니다. 창가나 건물 밖에서 다시 누르거나, 지도에서 출입구로 맞춰 주세요.`
            : `현재 위치로 맞췄어요 · 오차 약 ${rounded}m`,
        );
      },
      (err) => {
        setLocating(false);
        setNote(
          err.code === err.PERMISSION_DENIED
            ? '위치 권한이 거부돼 있어요. 브라우저 설정에서 이 사이트의 위치 권한을 허용해 주세요.'
            : '현재 위치를 가져오지 못했어요. 잠시 뒤 다시 눌러 주세요.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={capture}
        disabled={locating}
        className="flex h-11 w-full items-center justify-center rounded-xl border border-primary bg-white text-[14px] font-bold text-primary disabled:opacity-60"
      >
        {locating ? '위치를 확인하는 중…' : label}
      </button>
      {note && <p role="status" className="mt-2 text-[12px] text-sub">{note}</p>}
    </div>
  );
}
