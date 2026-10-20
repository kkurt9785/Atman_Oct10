'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { facilityKindBadge } from '@/lib/facility-mode';

export type SwitcherFacility = {
  id: string;
  name: string;
  facility_type: string;
  registration_source?: string | null;
  address_text: string;
  access_role: string;
};

// 사업장 전환기. 병원·약국과 긱워커 근무지를 오갈 수 있고, 바꾸면 서버 레이아웃이 다시 렌더되어 탭·가드가 그 사업장의 모드로 바뀐다.
export function FacilitySwitcher({ initialFacility }: { initialFacility?: SwitcherFacility | null }) {
  const [facilities, setFacilities] = useState<SwitcherFacility[]>(initialFacility?[initialFacility]:[]);
  const [selected, setSelected] = useState(initialFacility?.id??'');
  const [busy,setBusy]=useState(false);
  const switching=useRef(false);
  const [error,setError]=useState('');
  const current=facilities.find(facility=>facility.id===selected);
  const badge=facilityKindBadge(current);

  const load=useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/facilities', { cache: 'no-store' });
      if (!res.ok) throw new Error();

      const data = await res.json();
      const rows = (data.facilities ?? []) as SwitcherFacility[];
      if(!rows.length)throw new Error();
      setFacilities(rows);
      const currentFacilityId = typeof data.currentFacilityId === 'string'
        ? data.currentFacilityId
        : null;
      setSelected(
        currentFacilityId && rows.some((row) => row.id === currentFacilityId)
          ? currentFacilityId
          : rows[0]?.id ?? '',
      );
    } catch {setError('현장 목록을 불러오지 못했어요.');}
  },[]);
  useEffect(() => {void load();}, [load]);

  async function handleChange(facilityId: string) {
    if(switching.current||facilityId===selected)return;
    if(!window.confirm('현장을 전환할까요? 저장하지 않은 입력은 사라져요.'))return;
    switching.current=true;setBusy(true);setError('');
    const previous = selected;
    setSelected(facilityId);
    try {
    const res = await fetch('/api/facilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilityId }),
    });

    if (!res.ok) {
      throw new Error();
    }
    window.dispatchEvent(new Event('atman:facility-changed'));
    // Remount all facility-scoped inputs, caches and dialogs after the signed cookie changes.
    window.location.assign('/');
    } catch {setSelected(previous);setError('현장을 바꾸지 못했어요. 다시 선택해 주세요.');switching.current=false;setBusy(false);}
  }

  if (!current || facilities.length === 1) return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-white px-2.5 py-1.5">
      <span aria-hidden className="text-[1rem]">{badge.icon}</span>
      <div className="min-w-0"><p className="truncate text-[0.6875rem] font-extrabold text-ink">{current?.name??'현장 확인 중'}</p><p className="text-[0.5625rem] font-bold text-sub">{badge.label}</p>{error&&<button type="button" onClick={()=>void load()} className="min-h-11 text-xs font-bold text-red-700" aria-label="현장 목록 다시 불러오기">목록 재시도</button>}</div>
    </div>
  );

  return (
    <label className="relative flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-1">
      <span aria-hidden>{badge.icon}</span>
      <select
        value={selected}
        disabled={busy}
        onChange={(event) => void handleChange(event.target.value)}
        className="min-w-0 flex-1 appearance-none bg-transparent pr-4 text-[0.6875rem] font-extrabold text-ink outline-none"
        aria-label="사업장·현장 선택"
      >
        {facilities.map((facility) => {
          const kind=facilityKindBadge(facility);
          return <option key={facility.id} value={facility.id}>{facility.name} · {kind.label}</option>;
        })}
      </select>
      <span className="pointer-events-none absolute right-2 text-[0.6875rem] text-sub">⌄</span>
      {error&&<span role="alert" className="absolute left-0 top-full z-20 rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</span>}
    </label>
  );
}
