'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { AreaPref } from '@/components/onboarding/ActivityArea';
import {
  subscribeToPush,
  unsubscribeFromPush,
  getExistingSubscription,
} from '@/lib/push-subscribe';
import { PwaInstallSheet } from '@/components/PwaInstallSheet';

const PROFILE_TOTAL = 4;

export default function SettingsPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [locations, setLocations] = useState<AreaPref[]>([]);
  const [profileFilled, setProfileFilled] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/onboarding'); return; }

      setName(user.user_metadata?.profile_nickname ?? '사용자');

      const [{ data: prof }, { data: locPref }, { data: workerProf }] = await Promise.all([
        supabase.from('profiles').select('role').single(),
        supabase.from('worker_location_prefs').select('locations').single(),
        supabase.from('workers')
          .select('license_number, license_photo_url, experience_years, last_workplace, department_tags')
          .eq('auth_user_id', user.id)
          .maybeSingle(),
      ]);

      setRole(prof?.role ?? '');
      setLocations(locPref?.locations ?? []);

      if (workerProf) {
        const filled = [
          workerProf.license_number || workerProf.license_photo_url,
          workerProf.experience_years,
          workerProf.last_workplace,
          (workerProf.department_tags as string[] | null)?.length,
        ].filter(Boolean).length;
        setProfileFilled(filled);
      }

      const existing = await getExistingSubscription();
      setPushEnabled(!!existing);
    }
    load();
  }, [router]);

  async function handlePushToggle() {
    if (!('PushManager' in window)) {
      setShowPwaGuide(true);
      return;
    }

    setPushLoading(true);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) await supabase.from('push_subscriptions').delete().eq('worker_id', user.id);
        setPushEnabled(false);
      } else {
        const sub = await subscribeToPush();
        if (sub) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase.from('push_subscriptions').upsert({
              worker_id: user.id,
              subscription: sub.toJSON(),
            });
          }
          setPushEnabled(true);
        } else {
          alert('알림 권한을 허용해 주세요.');
        }
      }
    } finally {
      setPushLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/onboarding');
  }

  const roleLabel = role === 'rn' ? '간호사 RN' : role === 'na' ? '간호조무사 NA' : '';
  const profileDone = profileFilled >= PROFILE_TOTAL;

  return (
    <main className="px-4 pb-10">
      <div className="px-1 mt-2 mb-6">
        <h1 className="text-[24px] font-extrabold text-ink">내 정보</h1>
      </div>

      {/* 프로필 카드 */}
      <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-3xl">👤</div>
          <div>
            <p className="text-[18px] font-bold text-ink">{name || '...'}</p>
            {roleLabel && (
              <span className="text-[13px] font-semibold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
                {roleLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 내 프로필 카드 */}
      <Link href="/settings/profile">
        <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm flex items-center justify-between active:opacity-80">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-[15px] font-bold text-ink">내 프로필 카드</p>
              {profileDone ? (
                <span className="text-[11px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">완성</span>
              ) : (
                <span className="text-[11px] font-bold text-warn bg-warn/10 px-2 py-0.5 rounded-full">
                  {profileFilled}/{PROFILE_TOTAL} 완료
                </span>
              )}
            </div>
            <p className="text-[13px] text-tertiary">병원 HR 담당자에게 보이는 정보예요</p>
            {!profileDone && (
              <div className="mt-2 h-1.5 bg-bg rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${(profileFilled / PROFILE_TOTAL) * 100}%` }}
                />
              </div>
            )}
          </div>
          <span className="text-tertiary ml-3">›</span>
        </div>
      </Link>

      {/* 활동 지역 */}
      <Link href="/settings/location">
        <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm flex items-center justify-between active:opacity-80">
          <div>
            <p className="text-[15px] font-bold text-ink mb-1.5">활동 지역</p>
            {locations.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {locations.map((l) => (
                  <span key={l.label} className="text-[13px] text-sub bg-bg px-2.5 py-1 rounded-full">
                    📍 {l.label} ({l.radius_km}km)
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-tertiary">지역을 설정해주세요</p>
            )}
          </div>
          <span className="text-tertiary ml-3">›</span>
        </div>
      </Link>

      {/* 시프트 알림 */}
      <button
        onClick={handlePushToggle}
        disabled={pushLoading}
        className="w-full bg-white rounded-2xl p-5 mb-4 shadow-sm flex items-center justify-between active:opacity-80 disabled:opacity-60"
      >
        <div className="text-left">
          <p className="text-[15px] font-bold text-ink">시프트 알림</p>
          <p className="text-[13px] text-tertiary mt-0.5">
            {pushEnabled ? '새 시프트 공고를 즉시 알려드려요' : '알림을 켜면 새 시프트를 바로 받아요'}
          </p>
        </div>
        <div className={`w-12 h-7 rounded-full transition-colors flex-shrink-0 flex items-center px-1 ${pushEnabled ? 'bg-primary' : 'bg-line'}`}>
          <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${pushEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </div>
      </button>

      {showPwaGuide && <PwaInstallSheet onClose={() => setShowPwaGuide(false)} />}

      {/* 로그아웃 */}
      <button
        onClick={handleLogout}
        className="w-full py-4 text-center text-[15px] font-semibold text-red-500 border border-red-200 rounded-2xl bg-white active:opacity-70 mt-2"
      >
        로그아웃
      </button>
    </main>
  );
}
