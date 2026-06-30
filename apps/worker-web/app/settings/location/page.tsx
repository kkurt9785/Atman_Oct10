'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ActivityArea, type AreaPref } from '@/components/onboarding/ActivityArea';

export default function LocationSettingsPage() {
  const router = useRouter();
  const [initialLocations, setInitialLocations] = useState<AreaPref[] | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('worker_location_prefs').select('locations').single()
      .then(({ data }) => setInitialLocations(data?.locations ?? []));
  }, []);

  async function handleSave(areas: AreaPref[]) {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('worker_location_prefs').upsert({
        worker_id: user.id,
        locations: areas,
      });
    }
    setSaving(false);
    router.push('/settings');
  }

  if (initialLocations === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <ActivityArea
      onNext={handleSave}
      initialLocations={initialLocations}
      buttonLabel={saving ? '저장 중...' : '저장하기'}
      showHeader={false}
    />
  );
}
