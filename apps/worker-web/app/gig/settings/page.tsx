'use client';

import { useEffect, useState } from 'react';
import { BackButton } from '@/components/BackButton';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { subscribeToPush, unsubscribeFromPush, getExistingSubscription } from '@/lib/push-subscribe';
import { PwaInstallSheet } from '@/components/PwaInstallSheet';
import { PrivacySection } from '@/components/settings/PrivacySection';
import { DemoSignupCard } from '@/components/DemoSignup';
import { useDemoSession } from '@/lib/demo-session';
import { getLinkKinds, hasMedicalContext, rememberWorkerShell, setGigworkerModePreference } from '@/lib/worker-mode';

// 핵심 3탭 밖의 보조 설정. 계좌·지급은 /gig/settlement 에서만 관리한다.
export default function GigSettingsPage() {
  const router = useRouter();
  const demo = useDemoSession();
  const [name, setName] = useState('');
  // 의료 직군으로 등록했거나 병원·약국 직원으로 연결된 계정에만 모드 전환을 보여 준다.
  const [canSwitch, setCanSwitch] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushNotice, setPushNotice] = useState('');
  const [showPwaGuide, setShowPwaGuide] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }
      setName(user.user_metadata?.profile_nickname ?? '사용자');
      const [{ data: worker }, { data: staffLinks }] = await Promise.all([
        supabase.from('workers').select('id,role,name').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
        supabase.from('facility_staff').select('worker_kind').neq('status', 'ended'),
      ]);
      setCanSwitch(hasMedicalContext(getLinkKinds(staffLinks), worker?.role));
      setPushEnabled(Boolean(await getExistingSubscription()));
    }
    void load();
  }, [router]);

  async function handlePushToggle() {
    if (!('PushManager' in window)) { setShowPwaGuide(true); return; }
    setPushLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('로그인이 만료됐어요.');
      if (pushEnabled) {
        const currentSubscription = await getExistingSubscription();
        await unsubscribeFromPush();
        const deleteQuery = supabase.from('push_subscriptions').delete().eq('worker_id', user.id);
        const { error } = currentSubscription ? await deleteQuery.eq('endpoint', currentSubscription.endpoint) : await deleteQuery;
        if (error) throw error;
        setPushEnabled(false);
      } else {
        const sub = await subscribeToPush();
        if (!sub) { setPushNotice('브라우저 설정에서 알림 권한을 허용해 주세요.'); return; }
        const { error } = await supabase.from('push_subscriptions').upsert(
          { worker_id: user.id, endpoint: sub.endpoint, subscription: sub.toJSON() },
          { onConflict: 'worker_id,endpoint' },
        );
        if (error) { await unsubscribeFromPush().catch(() => undefined); throw error; }
        setPushEnabled(true);
      }
    } catch {
      setPushNotice('알림 설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPushLoading(false);
    }
  }

  function switchToMedical() {
    rememberWorkerShell('medical');
    router.replace('/home');
  }
  // 초대로 간편 가입한 긱워커(직군 'other')가 의료 워커로 올라가는 길. 온보딩의 직군 단계부터 다시 밟는다 —
  // complete_worker_onboarding 이 같은 계정의 직군·지역을 갱신하고, 끝나면 의료 셸(/home)로 간다.
  function startMedicalRegistration() {
    try { window.localStorage.removeItem('atman_auth_next'); } catch { /* 저장소 없어도 진행 */ }
    router.push('/onboarding?step=terms');
  }
  async function handleLogout() {
    await supabase.auth.signOut();
    setGigworkerModePreference(false);
    router.replace('/');
  }

  return (
    <main className="px-4 pb-10 pt-[env(safe-area-inset-top)]">
      {pushNotice && <p role="alert" className="mx-4 mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-700">{pushNotice}</p>}
      <div className="mb-6 mt-2 px-1">
        <BackButton href="/gig" label="오늘" />
        <span className="mt-2 flex w-fit rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-extrabold text-primary">초대 근무</span>
        <h1 className="mt-2 text-[24px] font-extrabold text-ink">앱 설정</h1>
        <p className="mt-1 text-[13px] text-sub">알림과 연결된 워커 모드만 관리해요. 계좌와 지급은 근태·지급 탭에 있어요.</p>
      </div>

      <div className="mb-4 rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-3xl">👤</div>
          <div>
            <p className="text-[18px] font-bold text-ink">{name || '...'}</p>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[13px] font-semibold text-primary">초대 근무</span>
          </div>
        </div>
      </div>

      <button
        onClick={handlePushToggle}
        role="switch"
        aria-checked={pushEnabled}
        aria-label="이 기기의 출근 알림"
        disabled={pushLoading}
        className="mb-4 flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow-sm active:opacity-80 disabled:opacity-60"
      >
        <div className="text-left">
          <p className="text-[15px] font-bold text-ink">이 기기 출근 알림</p>
          <p className="mt-0.5 text-[13px] text-tertiary">{pushEnabled ? '근무 시작 전 출근 안내를 보내드려요' : '알림을 켜면 출근 시간을 놓치지 않아요'}</p>
          <p className="mt-1 text-[11px] leading-4 text-sub">근무 30분 전 안내와 근태 알림을 앱 푸시로 받아요</p>
        </div>
        <div className={`flex h-7 w-12 flex-shrink-0 items-center rounded-full px-1 transition-colors ${pushEnabled ? 'bg-primary' : 'bg-line'}`}>
          <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${pushEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </div>
      </button>

      {canSwitch && <section className="mb-4 rounded-2xl border border-primary/20 bg-white p-5 shadow-sm">
        <p className="text-[11px] font-extrabold text-primary">근무 찾기</p>
        <p className="mt-1 text-[16px] font-extrabold text-ink">근무 찾기 화면으로 전환</p>
        <p className="mt-1 text-[12px] leading-5 text-sub">같은 계정의 프로필과 지원 내역을 그대로 이어서 봐요.</p>
        <button type="button" onClick={switchToMedical} className="mt-3 h-11 w-full rounded-xl bg-primary text-[13px] font-extrabold text-white">
          근무 찾기 열기
        </button>
      </section>}

      {!canSwitch && demo === false && <section className="mb-4 rounded-2xl border border-line bg-white p-5 shadow-sm">
        <p className="text-[11px] font-extrabold text-primary">근무 찾기</p>
        <p className="mt-1 text-[16px] font-extrabold text-ink">근무 찾기도 시작할래요</p>
        <p className="mt-1 text-[12px] leading-5 text-sub">간호사·간호조무사·약사·약국 사무 직군을 등록하면 같은 계정으로 근처 병원·약국 공고를 보고 지원할 수 있어요. 지금의 초대 근무는 그대로 유지돼요.</p>
        <button type="button" onClick={startMedicalRegistration} className="mt-3 h-11 w-full rounded-xl border border-primary bg-white text-[13px] font-extrabold text-primary">
          직군 등록하고 근무 찾기 열기
        </button>
      </section>}

      {showPwaGuide && <PwaInstallSheet onClose={() => setShowPwaGuide(false)} />}

      {/* 시연 계정이면 개인정보·로그아웃 대신 가입으로 잇는다 */}
      {demo === true && <DemoSignupCard />}
      {demo === false && <>
        <PrivacySection />
        <button onClick={handleLogout} className="mt-2 w-full rounded-2xl border border-red-200 bg-white py-4 text-center text-[15px] font-semibold text-red-500 active:opacity-70">
          로그아웃
        </button>
      </>}
    </main>
  );
}
