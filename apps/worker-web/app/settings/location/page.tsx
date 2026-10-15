'use client';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { ActivityArea, type AreaPref } from '@/components/onboarding/ActivityArea';
import { BackButton } from '@/components/BackButton';

export default function LocationSettingsPage() {
  const [initialLocations, setInitialLocations] = useState<AreaPref[] | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pending=useRef(false);
  const [loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(() => {
    let active=true;setLoadError('');
    void Promise.resolve(supabase.from('worker_location_prefs').select('locations').maybeSingle())
      .then(({data,error})=>{if(!active)return;if(error)throw new Error();setInitialLocations(data?.locations??[]);})
      .catch(()=>{if(active)setLoadError('저장한 지역을 불러오지 못했어요. 다시 시도해 주세요.');});
    return()=>{active=false;};
  }, [retry]);

  async function handleSave(areas: AreaPref[]) {
    if (pending.current) return;
    pending.current=true;
    setSaving(true);
    setError('');
    try {
    const { error: saveError } = await supabase.rpc('update_my_activity_areas', { p_areas: areas });
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
    }catch{setError('저장 결과를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');}
    finally{pending.current=false;setSaving(false);}
  }

  if(loadError)return <main className="p-6"><BackButton href="/settings" label="내 정보"/><p role="alert" className="mt-6 text-sm text-red-600">{loadError}</p><button type="button" onClick={()=>setRetry(n=>n+1)} className="mt-3 min-h-12 rounded-xl bg-primary px-5 font-bold text-white">다시 불러오기</button></main>;
  if (initialLocations === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="px-5 pt-4"><BackButton href="/settings" label="내 정보" /></div>
      {error && <p className="mx-6 mt-6 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-bold text-red-600">{error}</p>}
      <ActivityArea
        onNext={handleSave}
        disabled={saving}
        initialLocations={initialLocations}
        buttonLabel={saving ? '저장 중...' : '저장하기'}
        showHeader={false}
      />
    </>
  );
}
