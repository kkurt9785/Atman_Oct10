'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { AreaPref } from '@/components/onboarding/ActivityArea';

export default function SettingsPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [locations, setLocations] = useState<AreaPref[]>([]);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/onboarding'); return; }

      setName(user.user_metadata?.profile_nickname ?? '사용자');

      const [{ data: prof }, { data: locPref }] = await Promise.all([
        supabase.from('profiles').select('role').single(),
        supabase.from('worker_location_prefs').select('locations').single(),
      ]);

      setRole(prof?.role ?? '');
      setLocations(locPref?.locations ?? []);
    }
    load();
  }, [router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace('/onboarding');
  }

  const roleLabel = role === 'rn' ? '간호사 RN' : role === 'na' ? '간호조무사 NA' : '';

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
