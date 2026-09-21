'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createGigworkerWorkspace } from '@/lib/facility';
import { CurrentLocationButton, FacilityPinMap } from '@/components/FacilityPinMap';
import type { FacilitySearchHit } from '@/app/api/facility-search/route';

type Place = Pick<FacilitySearchHit, 'id' | 'name' | 'address' | 'lng' | 'lat'>;

export function GigworkerWorkspaceStart({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<{ lng: number; lat: number } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const naverMapUrl = useMemo(() => {
    const keyword = address || name;
    return keyword ? `https://map.naver.com/p/search/${encodeURIComponent(keyword)}` : null;
  }, [address, name]);

  function useCurrentLocation(next: { lng: number; lat: number }) {
    setPoint(next);
    setResults([]);
    setSearched(false);
    setError('');
  }

  async function searchPlace() {
    if (query.trim().length < 2 || searching) return;
    setSearching(true);
    setError('');
    try {
      const response = await fetch(`/api/facility-search?mode=gigworker&q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('search failed');
      const data = await response.json() as { hits?: FacilitySearchHit[] };
      // 긱워커는 기존 잇닿 사업장을 연결하거나 심평원 분류를 쓰지 않는다. 카카오 장소 좌표만 사용한다.
      setResults((data.hits ?? []).filter((hit) => hit.source === 'kakao' && hit.lng != null && hit.lat != null));
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
      setError('장소를 찾지 못했어요. 현재 위치를 사용하거나 잠시 뒤 다시 검색해 주세요.');
    } finally {
      setSearching(false);
    }
  }

  function choosePlace(place: Place) {
    if (place.lng == null || place.lat == null) return;
    setName(place.name);
    setAddress(place.address);
    setPoint({ lng: place.lng, lat: place.lat });
    setResults([]);
    setSearched(false);
  }

  function submit() {
    if (!name.trim()) {
      setError('근무지 이름을 입력해 주세요.');
      return;
    }
    if (!point) {
      setError('현재 위치를 설정하거나 지도에서 근무지를 선택해 주세요.');
      return;
    }
    setError('');
    startTransition(async () => {
      const result = await createGigworkerWorkspace({
        name: name.trim(),
        addressText: address.trim() || null,
        lng: point.lng,
        lat: point.lat,
      });
      if (!result.ok) {
        setError(result.error ?? '긱워커 근태를 시작하지 못했어요.');
        return;
      }
      router.replace('/staff?view=contract&entry=gigworker');
    });
  }

  return (
    <main className="min-h-screen bg-surface px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <button type="button" onClick={onBack} className="mb-7 text-[14px] font-bold text-sub">← 시작 방식 다시 선택</button>
        <div className="rounded-3xl bg-white p-5 shadow-card">
          <p className="text-[13px] font-bold text-primary">긱워커 근태 무료 베타</p>
          <h1 className="mt-1 text-[24px] font-extrabold text-ink">근무지와 출퇴근 기준을 정해요</h1>
          <p className="mt-2 text-[13px] leading-5 text-sub">사업자등록이나 병원·약국 인증 없이, 단기근로자를 초대해 바로 근태를 시작할 수 있어요.</p>

          <label className="mt-6 block text-[13px] font-bold text-ink">
            근무지 이름
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="예: 성수 팝업스토어" className="mt-2 h-12 w-full rounded-xl border border-line px-4 text-[15px] outline-none focus:border-primary" />
          </label>

          <section className="mt-6 rounded-2xl bg-primary/5 p-4">
            <h2 className="text-[15px] font-extrabold text-ink">근무지 위치</h2>
            <p className="mt-1 text-[12px] leading-5 text-sub">이 위치 반경 100m 안에서 출퇴근을 인증해요. 실내에서는 동적 QR로 보완할 수 있어요.</p>
            <CurrentLocationButton className="mt-3" label="현재 위치를 근무지로 설정" radiusMeters={100} onChange={useCurrentLocation} />
            <div className="my-4 flex items-center gap-2 text-[11px] text-sub"><span className="h-px flex-1 bg-primary/15" />또는<span className="h-px flex-1 bg-primary/15" /></div>
            <label className="block text-[12px] font-bold text-ink">지도에서 근무지 위치 검색</label>
            <div className="mt-2 flex gap-2">
              <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && searchPlace()} placeholder="예: 성수동 팝업스토어" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-[14px] outline-none focus:border-primary" />
              <button type="button" onClick={searchPlace} disabled={searching} className="h-11 rounded-xl bg-primary px-4 text-[13px] font-bold text-white disabled:opacity-60">{searching ? '검색 중' : '검색'}</button>
            </div>
            {searched && results.length === 0 && !error && <p className="mt-3 text-[12px] text-sub">카카오 지도에서 찾지 못했어요. 현재 위치를 사용해 주세요.</p>}
            {results.length > 0 && <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto">{results.map((place) => <li key={place.id}><button type="button" onClick={() => choosePlace(place)} className="w-full rounded-xl border border-line bg-white px-3 py-3 text-left"><p className="text-[13px] font-bold text-ink">{place.name}</p><p className="mt-1 text-[11px] text-sub">{place.address}</p></button></li>)}</ul>}
          </section>

          {point && <section className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-[14px] font-extrabold text-ink">핀과 인증 반경 확인</h2>{naverMapUrl && <a href={naverMapUrl} target="_blank" rel="noreferrer" className="text-[12px] font-bold text-primary underline">네이버 지도에서 보기</a>}</div>
            {address && <p className="mb-2 text-[12px] text-sub">{address}</p>}
            <FacilityPinMap lng={point.lng} lat={point.lat} radiusMeters={100} onChange={setPoint} />
          </section>}

          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-3 text-[12px] font-bold text-red-600">{error}</p>}
          <button type="button" onClick={submit} disabled={isPending} className="mt-6 h-12 w-full rounded-xl bg-ink text-[15px] font-extrabold text-white disabled:opacity-50">{isPending ? '근태 공간을 만드는 중…' : '긱워커 근태 시작하기'}</button>
          <p className="mt-3 text-center text-[11px] leading-4 text-sub">무료 베타에서는 최대 3명의 단기근로자를 연결할 수 있어요. 근무지와 출퇴근 기록은 계속 보관됩니다.</p>
        </div>
      </div>
    </main>
  );
}
