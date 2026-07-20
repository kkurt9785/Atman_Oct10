'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

type Area = { label: string; radius: number; lat?: number; lng?: number };

// 활성 병원이 있는 지역만 선택지로 노출 (SUGGESTIONS) — 병원 확보 시 추가
// 아래 legacy 키는 기존 가입자의 저장된 지역 좌표 복원용으로만 유지
const AREA_COORDS: Record<string, { lat: number; lng: number }> = {
  // 서비스 지역 — 수원 전역 4구 + 광주 광산구
  '수원 장안구':  { lat: 37.3037, lng: 127.0106 },
  '수원 권선구':  { lat: 37.2574, lng: 127.0286 },
  '수원 팔달구':  { lat: 37.2636, lng: 127.0305 },
  '수원 영통구':  { lat: 37.2905, lng: 127.0574 },
  '광주 광산구':  { lat: 35.1795, lng: 126.8121 },
  // legacy — 기존 저장된 지역 설정 호환용 (선택지에는 미노출)
  '경기 수원시':  { lat: 37.2636, lng: 127.0286 },
  '서울 강남구':  { lat: 37.5172, lng: 127.0473 },
  '서울 송파구':  { lat: 37.5145, lng: 127.1050 },
  '서울 마포구':  { lat: 37.5663, lng: 126.9014 },
};

const PinIcon = ({ color = '#3182F6' }: { color?: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6c0 3.75 4.5 9 4.5 9s4.5-5.25 4.5-9c0-2.485-2.015-4.5-4.5-4.5zm0 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" fill={color}/>
  </svg>
);

const RadiusSlider = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
  <div>
    <div className="flex items-center justify-between mb-2">
      <span className="text-[14px] font-medium text-sub">알림 반경</span>
      <span className="text-[13px] font-bold text-primary bg-primary-light px-3 py-1 rounded-full">
        반경 {value}km
      </span>
    </div>
    <input type="range" min={1} max={20} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full h-1.5 rounded-full accent-primary cursor-pointer" />
    <div className="flex justify-between mt-1">
      <span className="text-[11px] text-tertiary">1km</span>
      <span className="text-[11px] text-tertiary">20km</span>
    </div>
  </div>
);

// 활성 병원이 있는 지역만 선택지로 노출 — 병원 확보 시 여기에 추가
const SUGGESTIONS = ['수원 장안구', '수원 권선구', '수원 팔달구', '수원 영통구', '광주 광산구'];

export type AreaPref = { label: string; radius_km: number; lat?: number; lng?: number };

export function ActivityArea({
  onNext,
  initialLocations,
  buttonLabel = '다음 단계',
  showHeader = true,
}: {
  onNext: (areas: AreaPref[]) => void;
  initialLocations?: AreaPref[];
  buttonLabel?: string;
  showHeader?: boolean;
}) {
  const [primary, setPrimary] = useState<Area>({
    label: initialLocations?.[0]?.label ?? '수원 팔달구',
    radius: initialLocations?.[0]?.radius_km ?? 5,
    ...AREA_COORDS[initialLocations?.[0]?.label ?? '수원 팔달구'],
  });
  const [primaryRadius, setPrimaryRadius] = useState(initialLocations?.[0]?.radius_km ?? 5);
  const [second, setSecond] = useState<Area | null>(
    initialLocations?.[1] ? { label: initialLocations[1].label, radius: initialLocations[1].radius_km, ...AREA_COORDS[initialLocations[1].label] } : null
  );
  const [secondRadius, setSecondRadius] = useState(initialLocations?.[1]?.radius_km ?? 5);
  const [showSearch, setShowSearch] = useState<'primary' | 'second' | null>(null);
  const [query, setQuery] = useState('');

  const normalizedQuery = query.replace(/\s/g, '');
  const filtered = SUGGESTIONS.filter((s) => !normalizedQuery || s.replace(/\s/g, '').includes(normalizedQuery));

  function selectArea(label: string) {
    const coords = AREA_COORDS[label];
    if (showSearch === 'primary') {
      setPrimary({ label, radius: primaryRadius, ...coords });
    } else {
      setSecond({ label, radius: secondRadius, ...coords });
    }
    setShowSearch(null);
    setQuery('');
  }

  return (
    <div className="flex flex-col min-h-screen px-6 pt-14 pb-10">
      {showHeader && <p className="text-[13px] font-medium text-tertiary mb-2">단계 2 / 정보 입력</p>}
      <h1 className="text-[28px] font-bold text-ink letter-tight mb-1">
        시프트 알림 받을<br />지역을 설정해요
      </h1>
      <p className="text-[15px] text-sub mb-6">
        해당 지역에 시프트가 열리면 바로 알려드려요
      </p>

      {/* 지도 placeholder */}
      <div className="w-full rounded-card overflow-hidden bg-[#E8EDF2] flex-shrink-0 mb-5 flex flex-col items-center justify-center gap-2"
        style={{ height: '40vw', maxHeight: 180 }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M16 2C10.477 2 6 6.477 6 12c0 7.5 10 18 10 18s10-10.5 10-18c0-5.523-4.477-10-10-10zm0 13a3 3 0 110-6 3 3 0 010 6z" fill="#8B95A1"/>
        </svg>
        <span className="text-[12px] text-tertiary">카카오맵</span>
      </div>

      {/* 1번 지역 */}
      <div className="bg-white rounded-card shadow-card p-4 mb-3 border-2 border-primary">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-white text-[12px] font-bold">1</div>
            <span className="text-[15px] font-bold text-ink">주요 지역</span>
          </div>
          <button onClick={() => setShowSearch('primary')}
            className="flex items-center gap-1.5 bg-bg px-2.5 py-1 rounded-full active:opacity-70">
            <PinIcon />
            <span className="text-[13px] font-medium text-sub">{primary.label}</span>
          </button>
        </div>
        <RadiusSlider value={primaryRadius} onChange={setPrimaryRadius} />
      </div>

      {/* 2번 지역 */}
      {second ? (
        <div className="bg-white rounded-card shadow-card p-4 mb-3 border border-line">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-sub flex items-center justify-center text-white text-[12px] font-bold">2</div>
              <span className="text-[15px] font-bold text-ink">추가 지역</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-bg px-2.5 py-1 rounded-full">
                <PinIcon color="#4E5968" />
                <span className="text-[13px] font-medium text-sub">{second.label}</span>
              </div>
              <button onClick={() => setSecond(null)}
                className="w-6 h-6 rounded-full bg-line flex items-center justify-center flex-shrink-0">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1l8 8M9 1L1 9" stroke="#8B95A1" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          </div>
          <RadiusSlider value={secondRadius} onChange={setSecondRadius} />
        </div>
      ) : (
        /* 지역 추가 버튼 */
        <button onClick={() => setShowSearch('second')}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-card border-2 border-dashed border-line text-sub mb-3 active:opacity-70 transition-opacity">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="8" stroke="#8B95A1" strokeWidth="1.5"/>
            <path d="M9 5.5v7M5.5 9h7" stroke="#8B95A1" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="text-[15px] font-medium">자주 가는 지역 추가하기</span>
          <span className="text-[12px] text-tertiary">(선택)</span>
        </button>
      )}

      {/* 지역 검색 모달 */}
      {showSearch && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end">
          <div className="bg-white w-full rounded-t-[24px] p-6 max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[18px] font-bold text-ink">지역 검색</h3>
              <button onClick={() => setShowSearch(null)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l12 12M18 6L6 18" stroke="#191F28" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <input type="text" placeholder="지역명 입력 (예: 팔달구, 광산구)" value={query}
              onChange={(e) => setQuery(e.target.value)} autoFocus
              className="w-full h-12 px-4 rounded-xl border border-line text-[16px] text-ink placeholder:text-tertiary focus:border-primary outline-none mb-4" />
            <div className="overflow-y-auto">
              {filtered.length === 0 && (
                <p className="py-8 text-center text-[14px] text-tertiary">
                  아직 서비스하지 않는 지역이에요.<br />가까운 지역을 선택해 주세요.
                </p>
              )}
              {filtered.map((s) => (
                <button key={s} onClick={() => selectArea(s)}
                  className="flex items-center gap-3 w-full py-4 border-b border-line last:border-0 active:bg-bg">
                  <PinIcon color="#4E5968" />
                  <span className="text-[16px] text-ink">{s}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 안내 */}
      <p className="text-[13px] text-tertiary text-center mt-2 mb-6">
        💡 두 지역 모두 시프트가 열리면 즉시 알림이 가요
      </p>

      <div className="mt-auto">
        <Button onClick={() => {
          const result: AreaPref[] = [{
            label: primary.label, radius_km: primaryRadius,
            lat: primary.lat, lng: primary.lng,
          }];
          if (second) result.push({
            label: second.label, radius_km: secondRadius,
            lat: second.lat, lng: second.lng,
          });
          onNext(result);
        }}>{buttonLabel}</Button>
      </div>
    </div>
  );
}
