'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { subscribeToPush, unsubscribeFromPush, getExistingSubscription } from '@/lib/push-subscribe';
import { PwaInstallSheet } from '@/components/PwaInstallSheet';
import { BankAccount, type BankAccountValue } from '@/components/onboarding/BankAccount';
import { getFacilityRegistrationSources, hasMedicalContext, rememberWorkerShell, setGigworkerModePreference } from '@/lib/worker-mode';

// 긱워커 "내 정보" — 계정·출근 알림·모드 전환만. 프로필 카드·활동 지역·리워드는 의료 워커(/settings) 전용.
export default function GigSettingsPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  // 의료 직군으로 등록했거나 병원·약국 직원으로 연결된 사람은 모드 전환, 긱워커로만 가입한 사람(role=other)은 의료 워커 등록 안내
  const [canSwitch, setCanSwitch] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushNotice, setPushNotice] = useState('');
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const [workerName, setWorkerName] = useState('');
  const [bank, setBank] = useState<{ bank_name: string | null; account_last4: string | null } | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
  const [bankError, setBankError] = useState('');

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }
      setName(user.user_metadata?.profile_nickname ?? '사용자');
      const [{ data: worker }, { data: staffLinks }] = await Promise.all([
        supabase.from('workers').select('id,role,name').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
        supabase.from('facility_staff').select('facilities(registration_source)').neq('status', 'ended'),
      ]);
      const { data: primaryBank } = worker?.id
        ? await supabase.from('worker_bank_accounts').select('bank_name,account_number_last4')
          .eq('worker_id', worker.id).eq('is_primary', true).is('deleted_at', null).maybeSingle()
        : { data: null };
      setWorkerName(worker?.name ?? '');
      setBank(primaryBank ? { bank_name: primaryBank.bank_name ?? null, account_last4: primaryBank.account_number_last4 ?? null } : null);
      if (window.location.hash === '#bank' && !primaryBank?.account_number_last4) setBankOpen(true);
      setCanSwitch(hasMedicalContext(getFacilityRegistrationSources(staffLinks), worker?.role));
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

  // 지급 계좌: 관리자가 지급할 때 바로 입금하도록 워커 본인이 등록한다. 번호는 암호화 저장, 화면엔 은행·끝 4자리만.
  async function saveBank(value: BankAccountValue) {
    setBankSaving(true); setBankError('');
    const { error } = await supabase.rpc('upsert_my_bank_account', {
      p_bank_code: value.bankCode, p_bank_name: value.bankName, p_account_number: value.accountNumber, p_account_holder_name: workerName || name,
    });
    setBankSaving(false);
    if (error) { setBankError(error.message.replace(/^.*?: /, '') || '계좌를 저장하지 못했어요.'); return; }
    setBank({ bank_name: value.bankName, account_last4: value.accountNumber.replace(/\D/g, '').slice(-4) });
    setBankOpen(false);
  }

  function switchToMedical() {
    rememberWorkerShell('medical');
    router.replace('/home');
  }
  function startMedicalRegistration() {
    rememberWorkerShell('medical');
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
        <span className="inline-flex rounded-full bg-ink px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em] text-white">GIG WORKER</span>
        <h1 className="mt-2 text-[24px] font-extrabold text-ink">내 정보</h1>
        <p className="mt-1 text-[13px] text-sub">근무 초대 계정과 출근 알림을 관리해요.</p>
      </div>

      <div className="mb-4 rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-3xl">👤</div>
          <div>
            <p className="text-[18px] font-bold text-ink">{name || '...'}</p>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[13px] font-semibold text-primary">긱워커</span>
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

      <section id="bank" className="mb-4 rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-[15px] font-bold text-ink">지급 계좌</p><p className="mt-0.5 text-[13px] text-tertiary">{bank?.bank_name && bank?.account_last4 ? `${bank.bank_name} · ****${bank.account_last4}` : '아직 등록하지 않았어요'}</p></div>
          <button type="button" onClick={() => setBankOpen((open) => !open)} className="h-9 shrink-0 rounded-lg bg-primary/10 px-3 text-[12px] font-extrabold text-primary">{bankOpen ? '닫기' : bank?.account_last4 ? '변경' : '등록'}</button>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-sub">관리자가 근무 급여를 지급할 때 이 계좌로 보내요. 계좌번호는 암호화되어 저장되고 관리자에게는 은행과 끝 4자리만 보여요.</p>
        {bankOpen && <div className="mt-3 rounded-xl bg-bg p-3"><BankAccount compact onNext={(value) => void saveBank(value)} submitting={bankSaving} submitError={bankError} /></div>}
      </section>

      <section className="mb-4 rounded-2xl border border-primary/20 bg-white p-5 shadow-sm">
        <p className="text-[11px] font-extrabold tracking-[0.12em] text-primary">MEDICAL SHIFT</p>
        <p className="mt-1 text-[16px] font-extrabold text-ink">{canSwitch ? '병원·약국 일자리도 확인할까요?' : '병원·약국 일자리도 찾을 수 있어요'}</p>
        <p className="mt-1 text-[12px] leading-5 text-sub">{canSwitch ? '기존 프로필과 지원 내역은 그대로 유지돼요.' : '직군과 활동 지역을 추가하면 기존 긱 근무 기록은 유지돼요.'}</p>
        <button type="button" onClick={canSwitch ? switchToMedical : startMedicalRegistration} className="mt-3 h-11 w-full rounded-xl bg-primary text-[13px] font-extrabold text-white">
          {canSwitch ? '병원·약국 일자리 모드로 전환' : '의료 워커 정보 등록하기'}
        </button>
      </section>

      {showPwaGuide && <PwaInstallSheet onClose={() => setShowPwaGuide(false)} />}

      <button onClick={handleLogout} className="mt-2 w-full rounded-2xl border border-red-200 bg-white py-4 text-center text-[15px] font-semibold text-red-500 active:opacity-70">
        로그아웃
      </button>
    </main>
  );
}
