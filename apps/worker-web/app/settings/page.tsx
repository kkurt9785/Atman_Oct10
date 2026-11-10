'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { AreaPref } from '@/components/onboarding/ActivityArea';
import {
  enableShiftPush,
  disableShiftPush,
  isShiftPushEnabled,
} from '@/lib/push-subscribe';
import { PwaInstallSheet } from '@/components/PwaInstallSheet';
import { PrivacySection } from '@/components/settings/PrivacySection';
import { DemoSignupCard } from '@/components/DemoSignup';
import { BankAccountRow } from '@/components/settings/BankAccountRow';
import { useDemoSession } from '@/lib/demo-session';
import { displayRoleLabel } from '@/lib/roles';
import { getLinkKinds, hasGigworkerLink, isGigLink, rememberWorkerShell, setGigworkerModePreference } from '@/lib/worker-mode';
import { PROFILE_TOTAL, profileFilledCount } from '@/lib/profile-fields';
import { useStaffFirst } from '@/lib/use-staff-first';

// 의료 워커 "내 정보". 긱워커 전용 설정은 /gig/settings — 여기서는 긱 근무가 연결돼 있으면 그 화면으로 가는 카드만 보여 준다.
export default function SettingsPage() {
  const router = useRouter();
  const demo = useDemoSession();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [locations, setLocations] = useState<AreaPref[]>([]);
  const [profileFilled, setProfileFilled] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);
  const pushBusy = useRef(true);
  const [pushNotice, setPushNotice] = useState('');
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const [locationSaved, setLocationSaved] = useState(false);
  const [gigworkerLinked, setGigworkerLinked] = useState(false);
  // 사업장이 명부에 적은 직종 — 초대로 간편 가입한 직원(직군 'other')의 이름표에 쓴다
  const [staffRole, setStaffRole] = useState<string | null>(null);
  const staffFirst = useStaffFirst() === true;

  useEffect(() => {
    let active = true;
    void isShiftPushEnabled().then(enabled => { if (active) setPushEnabled(enabled); })
      .catch(() => { if (active) setPushNotice('알림 등록 상태를 확인하지 못했어요. 아래 버튼으로 다시 설정해 주세요.'); })
      .finally(() => { if (active) { pushBusy.current = false; setPushLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setLocationSaved(new URLSearchParams(window.location.search).get('locationSaved') === '1');
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/onboarding'); return; }

      const nickname = user.user_metadata?.profile_nickname as string | undefined;
      setName(nickname ?? '사용자');

      const [{ data: locPref }, { data: workerProf }, { data: staffLinks }] = await Promise.all([
        // 활동 지역 행이 없는 계정도 있다 — single()이면 406
        supabase.from('worker_location_prefs').select('locations').maybeSingle(),
        supabase.from('workers')
          .select('id, name, role, license_number, license_photo_url, experience_years, last_workplace, department_tags')
          .eq('auth_user_id', user.id)
          .maybeSingle(),
        supabase.from('facility_staff').select('worker_id,worker_kind,role').neq('status', 'ended'),
      ]);

      // 가입한 이름(계좌 예금주와 같은 이름)이 먼저, 카카오 닉네임은 이름이 없을 때만
      if (workerProf?.name) setName(workerProf.name);
      setGigworkerLinked(hasGigworkerLink(getLinkKinds(staffLinks)));
      setRole(workerProf?.role ?? '');
      // 같은 계정이 사업장 관리자이기도 하면 다른 직원 행이 섞일 수 있어, 직종은 내 행에서만 읽는다
      const myStaffLinks = ((staffLinks ?? []) as Array<{ worker_id: string | null; worker_kind?: string | null; role: string | null }>)
        .filter((link) => workerProf?.id && link.worker_id === workerProf.id && !isGigLink(link));
      setStaffRole(myStaffLinks.find((link) => link.role && link.role !== 'other')?.role ?? myStaffLinks[0]?.role ?? null);
      setLocations(locPref?.locations ?? []);

      if (workerProf) {
        // 면허 칸은 그 직군에서 필수일 때만 센다(lib/profile-fields.ts) — 치과위생사·요양보호사·기타 직군이 면허 때문에 미완성으로 남지 않게
        setProfileFilled(profileFilledCount(workerProf));
      }

    }
    load();
  }, [router]);

  async function handlePushToggle() {
    if (pushBusy.current) return;
    setPushNotice('');
    if (!('PushManager' in window)) {
      setShowPwaGuide(true);
      return;
    }

    pushBusy.current = true;
    setPushLoading(true);
    try {
      if (pushEnabled) {
        await disableShiftPush();
        setPushEnabled(false);
      } else {
        const result = await enableShiftPush();
        if (result === 'enabled') setPushEnabled(true);
        else if (result === 'unsupported') setShowPwaGuide(true);
        else setPushNotice('브라우저 설정에서 알림 권한을 허용해 주세요.');
      }
    } catch (toggleError) {
      setPushNotice('알림 설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      pushBusy.current = false;
      setPushLoading(false);
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setGigworkerModePreference(false);
    router.replace('/');
  }

  function openGigworker() {
    rememberWorkerShell('gig');
    router.push('/gig');
  }

  const roleLabel = displayRoleLabel(role, staffRole);
  const profileDone = profileFilled >= PROFILE_TOTAL;

  const profileCard = (
        <Link href="/settings/profile">
          <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm flex items-center justify-between active:opacity-80">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-[15px] font-bold text-ink">내 프로필 카드</p>
                {profileDone ? (
                  <span className="text-[11px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">완성</span>
                ) : staffFirst ? (
                  // 직원에게 프로필 카드는 다른 근무에 지원할 때만 쓰인다 — 덜 채웠다고 재촉하지 않는다
                  <span className="text-[11px] font-bold text-sub bg-bg px-2 py-0.5 rounded-full">선택</span>
                ) : (
                  <span className="text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    {profileFilled}/{PROFILE_TOTAL} 완료
                  </span>
                )}
              </div>
              <p className="text-[13px] text-tertiary">{staffFirst ? '다른 근무에 지원할 때 담당자에게 보이는 정보예요. 지금 직장 출퇴근에는 필요 없어요' : '지원한 사업장 담당자에게 보이는 정보예요'}</p>
              {!profileDone && !staffFirst && (
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
  );
  const locationCard = (
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
                <p className="text-[13px] text-tertiary">지역을 설정해 주세요</p>
              )}
            </div>
            <span className="text-tertiary ml-3">›</span>
          </div>
        </Link>
  );
  const rewardsCard = (
        <Link href="/rewards">
          <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm flex items-center justify-between active:opacity-80">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-bold text-ink">잇닿 리워드·친구 초대</p>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">혜택</span>
              </div>
              <p className="mt-1.5 text-[13px] text-tertiary">첫 근무 진행과 초대 현황을 확인해요</p>
            </div>
            <span className="text-tertiary ml-3">›</span>
          </div>
        </Link>
  );
  const pushCard = (
        <button
          onClick={handlePushToggle}
          role="switch"
          aria-checked={pushEnabled}
          aria-label={staffFirst ? '이 기기의 알림' : '이 기기의 새 근무 알림'}
          disabled={pushLoading}
          className="w-full bg-white rounded-2xl p-5 mb-4 shadow-sm flex items-center justify-between active:opacity-80 disabled:opacity-60"
        >
          <div className="text-left">
            <p className="text-[15px] font-bold text-ink">{staffFirst ? '알림' : '새 근무 알림'}</p>
            <p className="text-[13px] text-tertiary mt-0.5">
              {pushLoading ? '알림 설정을 확인하고 있어요...' : staffFirst
                ? (pushEnabled ? '내 직장 소식을 이 기기로 알려드려요' : '알림을 켜면 내 직장 소식을 바로 받아요')
                : pushEnabled ? '내 직군·활동 지역의 새 근무를 이 기기로 알려드려요' : '알림을 켜면 내 지역 새 근무를 바로 받아요'}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-sub">{staffFirst ? '출퇴근 안내·사업장 채팅을 앱 푸시로 받아요. 새 공고 알림도 이 스위치로 함께 켜지고 꺼져요' : '새 공고·채용 확정·사업장 채팅을 앱 푸시로 받아요'}</p>
          </div>
          <div className={`w-12 h-7 rounded-full transition-colors flex-shrink-0 flex items-center px-1 ${pushEnabled ? 'bg-primary' : 'bg-line'}`}>
            <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${pushEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </div>
        </button>
  );

  return (
    <main className="px-4 pb-10 pt-[max(48px,env(safe-area-inset-top))]">
      {locationSaved && (
        <p role="status" className="mx-4 mt-3 rounded-xl bg-green-50 px-3 py-2 text-[13px] font-bold text-green-700">
          활동 지역을 저장했어요.
        </p>
      )}
      {pushNotice && (
        <p role="alert" className="mx-4 mt-3 rounded-xl bg-amber-50 text-amber-700 text-[13px] font-bold px-3 py-2">{pushNotice}</p>
      )}
      <div className="px-1 mb-6">
        <h1 className="text-[28px] font-extrabold text-ink">내 정보</h1>
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

      {gigworkerLinked && (
        <section className="mb-4 rounded-2xl border border-primary/20 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-extrabold text-primary">초대 근무</p>
          <p className="mt-1 text-[16px] font-extrabold text-ink">초대받은 근무가 있어요</p>
          <p className="mt-1 text-[12px] leading-5 text-sub">홈 맨 위 스위치로도 바로 바꿀 수 있어요. 초대 일정·출근하기·대화·지급을 봐요.</p>
          <button type="button" onClick={openGigworker} className="mt-3 h-11 w-full rounded-xl bg-primary text-[13px] font-extrabold text-white">
            초대 근무 열기
          </button>
        </section>
      )}

      {/* 직원으로 연결된 사람: 알림·계좌가 먼저, 근무 찾기용 설정(프로필 카드·활동 지역·리워드)은 접어 둔다(2026-11-10 치과 QA P1-12).
          연결이 없는 사람은 지금까지의 순서 그대로다 */}
      {staffFirst ? <>
        {pushCard}
        <BankAccountRow />
        <details className="mb-4 rounded-2xl bg-bg/60">
          <summary className="flex min-h-11 cursor-pointer items-center px-2 text-[13px] font-bold text-sub">다른 근무를 찾을 때 쓰는 설정</summary>
          <div className="pt-2">
            {profileCard}
            {locationCard}
            {rewardsCard}
          </div>
        </details>
      </> : <>
        {profileCard}
        {locationCard}
        <BankAccountRow />
        {rewardsCard}
        {pushCard}
      </>}

      {showPwaGuide && <PwaInstallSheet onClose={() => setShowPwaGuide(false)} />}

      {/* 시연 계정이면 개인정보·로그아웃 대신 가입으로 잇는다 */}
      {demo && <DemoSignupCard kind={demo} />}
      {demo === false && <>
        <div className="mt-4"><PrivacySection /></div>
        <button
          onClick={handleLogout}
          className="w-full py-4 text-center text-[15px] font-semibold text-red-500 border border-red-200 rounded-2xl bg-white active:opacity-70 mt-2"
        >
          로그아웃
        </button>
      </>}
    </main>
  );
}
