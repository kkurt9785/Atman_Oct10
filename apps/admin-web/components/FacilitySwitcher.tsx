'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';

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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/facilities', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;

      const data = await res.json();
      const rows = (data.facilities ?? []) as Facility[];
      setFacilities(rows);
      const currentFacilityId = typeof data.currentFacilityId === 'string' ? data.currentFacilityId : null;
      setSelected(currentFacilityId && rows.some((row) => row.id === currentFacilityId) ? currentFacilityId : rows[0]?.id ?? '');
    }
    load();
  }, []);

  async function handleChange(facilityId: string) {
    setSelected(facilityId);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch('/api/facilities', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ facilityId }),
    });
    if (res.ok) router.refresh();
  }

  if (facilities.length <= 1) return null;

  return (
    <select
      value={selected}
      onChange={(e) => handleChange(e.target.value)}
      className="max-w-[150px] bg-white border border-line rounded-lg px-2 py-1 text-[12px] font-semibold text-ink"
      aria-label="병원 선택"
    >
      {facilities.map((f) => (
        <option key={f.id} value={f.id}>{f.name}</option>
      ))}
    </select>
  );
}
