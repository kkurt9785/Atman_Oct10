'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { facilityKindBadge } from '@/lib/facility-mode';

type Facility = {
  id: string;
  name: string;
  facility_type: string;
  registration_source?: string | null;
  address_text: string;
  access_role: string;
};

// 사업장 전환기. 병원·약국과 긱워커 근무지를 오갈 수 있고, 바꾸면 서버 레이아웃이 다시 렌더되어 탭·가드가 그 사업장의 모드로 바뀐다.
export function FacilitySwitcher() {
  const router = useRouter();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selected, setSelected] = useState('');
  const current=facilities.find(facility=>facility.id===selected);
  const badge=facilityKindBadge(current);

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/facilities', { cache: 'no-store' });
      if (!res.ok) return;

      const data = await res.json();
      const rows = (data.facilities ?? []) as Facility[];
      setFacilities(rows);
      const currentFacilityId = typeof data.currentFacilityId === 'string'
        ? data.currentFacilityId
        : null;
      setSelected(
        currentFacilityId && rows.some((row) => row.id === currentFacilityId)
          ? currentFacilityId
          : rows[0]?.id ?? '',
      );
    }
    void load();
  }, []);

  async function handleChange(facilityId: string) {
    const previous = selected;
    setSelected(facilityId);

    const res = await fetch('/api/facilities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilityId }),
    });

    if (!res.ok) {
      setSelected(previous);
      return;
    }
    window.dispatchEvent(new Event('atman:facility-changed'));
    router.refresh();
  }

  if (!current) return null;
  if (facilities.length === 1) return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-white px-2.5 py-1.5">
      <span aria-hidden className="text-[16px]">{badge.icon}</span>
      <div className="min-w-0"><p className="truncate text-[11px] font-extrabold text-ink">{current.name}</p><p className="text-[9px] font-bold text-sub">{badge.label}</p></div>
    </div>
  );

  return (
    <label className="relative flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-1">
      <span aria-hidden>{badge.icon}</span>
      <select
        value={selected}
        onChange={(event) => void handleChange(event.target.value)}
        className="min-w-0 flex-1 appearance-none bg-transparent pr-4 text-[11px] font-extrabold text-ink outline-none"
        aria-label="사업장 선택"
      >
        {facilities.map((facility) => {
          const kind=facilityKindBadge(facility);
          return <option key={facility.id} value={facility.id}>{kind.icon} {facility.name} · {kind.label}</option>;
        })}
      </select>
      <span className="pointer-events-none absolute right-2 text-[10px] text-sub">⌄</span>
    </label>
  );
}
