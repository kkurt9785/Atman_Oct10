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

  if (facilities.length <= 1) return null;

  return (
    <select
      value={selected}
      onChange={(event) => void handleChange(event.target.value)}
      className="max-w-[150px] rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink"
      aria-label="병원 선택"
    >
      {facilities.map((facility) => (
        <option key={facility.id} value={facility.id}>{facility.name}</option>
      ))}
    </select>
  );
}
