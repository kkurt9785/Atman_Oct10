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
      window.kakao.maps.load(() => {
        if (!mapEl.current || mapRef.current) return;
        const center = new window.kakao.maps.LatLng(lat, lng);
        const map = new window.kakao.maps.Map(mapEl.current, { center, level: 3 });
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
      {error ? <p role="alert" className="mt-2 text-[12px] text-warn">{error}</p>
        : <p className="mt-2 text-[12px] text-sub">핀을 끌거나 지도를 탭해 <b>출입구 위치</b>로 맞춰 주세요. 원은 출퇴근 인증 반경 미리보기예요.</p>}
    </div>
  );
}
