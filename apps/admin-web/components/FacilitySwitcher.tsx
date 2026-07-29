'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Facility = {
  id: string;
  name: string;
  facility_type: string;
  address_text: string;
  access_role: string;
};

export function FacilitySwitcher() {
  const router = useRouter();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [selected, setSelected] = useState('');
  const current=facilities.find(facility=>facility.id===selected);
  const isPharmacy=current?.facility_type==='pharmacy';

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
    router.refresh();
  }

  if (!current) return null;
  if (facilities.length === 1) return (
    <div className="flex max-w-[175px] items-center gap-2 rounded-xl border border-line bg-white px-2.5 py-1.5">
      <span aria-hidden className="text-[16px]">{isPharmacy?'💊':'🏥'}</span>
      <div className="min-w-0"><p className="truncate text-[11px] font-extrabold text-ink">{current.name}</p><p className="text-[9px] font-bold text-sub">{isPharmacy?'약국':'병원·의원'}</p></div>
    </div>
  );

  return (
    <label className="relative flex max-w-[185px] items-center gap-1.5 rounded-xl border border-line bg-white px-2 py-1">
      <span aria-hidden>{isPharmacy?'💊':'🏥'}</span>
      <select
        value={selected}
        onChange={(event) => void handleChange(event.target.value)}
        className="min-w-0 flex-1 appearance-none bg-transparent pr-4 text-[11px] font-extrabold text-ink outline-none"
        aria-label="사업장 선택"
      >
        {facilities.map((facility) => (
          <option key={facility.id} value={facility.id}>{facility.facility_type==='pharmacy'?'💊':'🏥'} {facility.name} · {facility.facility_type==='pharmacy'?'약국':'병원·의원'}</option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 text-[10px] text-sub">⌄</span>
    </label>
  );
}
