'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ActivityArea, type AreaPref } from '@/components/onboarding/ActivityArea';

export default function LocationSettingsPage() {
  const router = useRouter();
  const [initialLocations, setInitialLocations] = useState<AreaPref[] | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('worker_location_prefs').select('locations').single()
      .then(({ data }) => setInitialLocations(data?.locations ?? []));
  }, []);

  async function handleSave(areas: AreaPref[]) {
    if (saving) return;
    setSaving(true);
    setError('');
    const { error: saveError } = await supabase.rpc('update_my_activity_areas', { p_areas: areas });
    setSaving(false);
    if (saveError) {
      setError(saveError.message.replace(/^.*?: /, ''));
      return;
    }
    router.refresh();
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
    <>
      {error && <p className="mx-6 mt-6 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">{error}</p>}
      <ActivityArea
      onNext={handleSave}
      initialLocations={initialLocations}
      buttonLabel={saving ? '저장 중...' : '저장하기'}
      showHeader={false}
    />
    </>
  );
}
