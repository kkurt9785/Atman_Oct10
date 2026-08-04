'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ActivityArea, type AreaPref } from '@/components/onboarding/ActivityArea';

export default function LocationSettingsPage() {
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

    // 저장 직후 목적지의 캐시된 설정값이 보이면 사용자는 저장 실패로 오해한다.
    // 서버 값을 한 번 검증한 뒤 전체 이동하여 최신 활동지역을 확실히 다시 읽는다.
    const { data: saved, error: verifyError } = await supabase
      .from('worker_location_prefs')
      .select('locations')
      .single();
    if (verifyError || !Array.isArray(saved?.locations)) {
      setSaving(false);
      setError('지역은 저장됐지만 확인하지 못했어요. 잠시 후 다시 확인해 주세요.');
      return;
    }
    window.location.replace('/settings?locationSaved=1');
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
