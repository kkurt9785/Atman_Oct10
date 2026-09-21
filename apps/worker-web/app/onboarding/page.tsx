'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Splash } from '@/components/onboarding/Splash';
import { Terms, type TermsValue } from '@/components/onboarding/Terms';
import { RoleSelect } from '@/components/onboarding/RoleSelect';
import { ActivityArea, type AreaPref } from '@/components/onboarding/ActivityArea';
import { LicenseUpload } from '@/components/onboarding/LicenseUpload';
import { BasicInfo, type BasicInfoValue } from '@/components/onboarding/BasicInfo';
import { BankAccount, type BankAccountValue } from '@/components/onboarding/BankAccount';
import { ReviewPending } from '@/components/onboarding/ReviewPending';
import { Approval } from '@/components/onboarding/Approval';
import { NotificationSetup } from '@/components/onboarding/NotificationSetup';
import { LICENSED_ROLES, type WorkerRole } from '@/lib/roles';

type Step = 'splash' | 'terms' | 'role' | 'license' | 'info' | 'area' | 'bank' | 'notification' | 'review' | 'approval';
const VALID_STEPS = new Set<Step>(['splash','terms','role','license','info','area','bank','notification','review','approval']);
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const param = searchParams.get('step') as Step | null;
  const terminalDeepLink = param === 'notification' || param === 'review' || param === 'approval';
  const [step, setStep] = useState<Step>(param && VALID_STEPS.has(param) ? param : 'splash');
  const [checkingDeepLink, setCheckingDeepLink] = useState(terminalDeepLink);
  const [terms, setTerms] = useState<TermsValue | null>(null);
  const [role, setRole] = useState<WorkerRole | null>(null);
  const [areas, setAreas] = useState<AreaPref[]>([]);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licenseNumber, setLicenseNumber] = useState('');
  const [basicInfo, setBasicInfo] = useState<BasicInfoValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [completionStep, setCompletionStep] = useState<'review' | 'approval'>('approval');

  // 가입 중 브라우저 뒤로가기를 눌러도 입력값을 유지한 채 이전 단계로 돌아간다.
  // Next 라우팅 대신 history만 갱신해 이 페이지의 로컬 입력 상태를 보존한다.
  const go = (next: Step) => {
    setStep(next);
    window.history.pushState({ onboardingStep: next }, '', `/onboarding?step=${next}`);
  };

  const finishOnboarding=()=>{
    const next=window.localStorage.getItem('atman_auth_next');
    if(next?.startsWith('/')){
      window.localStorage.removeItem('atman_auth_next');
      router.replace(next);
    }else{
      router.replace('/home');
    }
  };

  // bank 가 null 이면 계좌를 건너뛴 것이다. 급여를 사업장이 직접 주는 근태 전용
  // 사용자는 계좌를 등록할 이유가 없다. 알바 정산이 필요해지면 '내 정보'에서 넣는다.
  async function handleSubmit(bank: BankAccountValue | null) {
    if (submitting) return;
    if (!terms || !role || !basicInfo) {
      setSubmitError('가입 정보가 일부 누락됐어요. 처음부터 다시 확인해 주세요.');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    let uploadedPath: string | null = null;

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error('로그인이 만료됐어요. 다시 로그인해 주세요.');

      if (licenseFile) {
        const ext = MIME_EXT[licenseFile.type];
        if (!ext) throw new Error('지원하지 않는 서류 파일 형식이에요.');
        uploadedPath = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('license-photos').upload(uploadedPath, licenseFile, {
          cacheControl: '3600', upsert: false, contentType: licenseFile.type,
        });
        if (uploadError) throw new Error(`서류 파일 업로드 실패: ${uploadError.message}`);
      }

      const { error: rpcError } = await supabase.rpc('complete_worker_onboarding', {
        p_role: role,
        p_name: basicInfo.name,
        p_phone: basicInfo.phone,
        p_birth_date: terms.birthDate,
        p_areas: areas,
        p_license_path: uploadedPath,
        p_bank_code: bank?.bankCode ?? null,
        p_bank_name: bank?.bankName ?? null,
        p_account_number: bank?.accountNumber ?? null,
        p_account_holder_name: bank ? basicInfo.name : null,
        p_consents: terms.consents,
      });
      if (rpcError) throw new Error(rpcError.message.replace(/^.*?: /, ''));

      // 면허 번호 입력 시: 번호 전용 RPC로 저장.
      // (update_my_worker_profile은 경력·근무지·태그 필수라 온보딩 직후 호출은 항상 실패했음 — 감사에서 발견)
      // 실패해도 가입 자체는 유효 — 번호는 나의 정보에서 재등록 가능하므로 흐름을 막지 않는다.
      if (licenseNumber) {
        await supabase.rpc('set_my_license_number', { p_number: licenseNumber })
          .then(({ error: profileError }) => {
            if (profileError) console.warn('면허 번호 저장 실패(나의 정보에서 재등록 가능):', profileError.message);
          });
      }

      // 전산·사무직은 서류(이력서)와 무관하게 프로필 완성이 승인 경로 → approval 안내 화면으로
      // 플랫폼 심사 대기 화면은 이제 어느 직군에도 해당하지 않는다 (자격은 사업장이 확정 전 확인)
      setCompletionStep('approval');
      go('notification');
    } catch (error) {
      if (uploadedPath) await supabase.storage.from('license-photos').remove([uploadedPath]).catch(() => undefined);
      setSubmitError(error instanceof Error ? error.message : '가입 정보 저장에 실패했어요.');
    } finally {
      setSubmitting(false);
    }
  }

  // ?step= 딥링크로 선행 상태 없이 진입하면 백지가 되므로 스플래시로 되돌린다.
  useEffect(() => {
    const needsTerms: Step[] = ['role', 'license', 'info', 'area', 'bank'];
    if (needsTerms.includes(step) && !terms) {
      setStep('splash');
      window.history.replaceState({ onboardingStep: 'splash' }, '', '/onboarding');
    }
  }, [step, terms]);

  useEffect(() => {
    const restoreStep = () => {
      const restored = new URLSearchParams(window.location.search).get('step') as Step | null;
      setStep(restored && VALID_STEPS.has(restored) ? restored : 'splash');
    };
    window.addEventListener('popstate', restoreStep);
    return () => window.removeEventListener('popstate', restoreStep);
  }, []);

  useEffect(() => {
    if (!terminalDeepLink) return;
    let active = true;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (active) { setStep('splash'); setCheckingDeepLink(false); }
        return;
      }
      const [{ data: profile }, { data: worker }] = await Promise.all([
        supabase.from('profiles').select('onboarding_done').eq('id', user.id).maybeSingle(),
        supabase.from('workers').select('role,verification_status').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
      ]);
      if (!active) return;
      if (!profile?.onboarding_done || !worker?.role) {
        setStep('splash');
      } else {
        setRole(worker.role as WorkerRole);
        // 간호직·약국사무는 플랫폼 심사를 거치지 않으므로 '심사 중' 화면이 영구히 남는다.
        // 자격은 사업장이 확정 전에 확인하는 구조라 완료 안내로 보낸다.
        // 플랫폼 심사 대기 화면은 어느 직군에도 걸리지 않는다. 자격은 사업장이 확정 전 확인한다.
        const skipsPlatformReview = typeof worker.role === 'string' && worker.role.length > 0;
        setCompletionStep(
          worker.verification_status === 'approved' || skipsPlatformReview ? 'approval' : 'review',
        );
      }
      setCheckingDeepLink(false);
    })();
    return () => { active = false; };
  }, [terminalDeepLink]);

  const PREV: Partial<Record<Step, Step>> = { terms: 'splash', role: 'terms', license: 'role', area: 'info', bank: 'area' };
  const prevStep = step === 'info' ? (role && LICENSED_ROLES.includes(role) ? 'license' : 'role') : PREV[step];

  return (
    <main className="min-h-screen bg-white">
      {checkingDeepLink && <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}
      {!checkingDeepLink && <>
      {/* 단계 이동 중 오입력 복구용 뒤로가기 */}
      {prevStep && !submitting && (
        <button
          type="button"
          aria-label="이전 단계로"
          onClick={() => go(prevStep)}
          className="fixed top-[calc(env(safe-area-inset-top)+8px)] left-4 z-40 w-10 h-10 rounded-full bg-bg text-ink text-[18px] flex items-center justify-center active:opacity-70"
        >
          ←
        </button>
      )}
      {step === 'splash' && <Splash />}
      {step === 'terms' && <Terms onNext={(value) => { setTerms(value); go('role'); }} />}
      {step === 'role' && <RoleSelect onNext={(value) => { setRole(value); go(LICENSED_ROLES.includes(value) ? 'license' : 'info'); }} />}
      {/* 가입 때는 간호직 서류를 묻지 않는다. 약사·약국 사무직만 직군 필수 서류를 받는다. */}
      {step === 'license' && <LicenseUpload role={role} onNext={({ file, number }) => { setLicenseFile(file); setLicenseNumber(number); go('info'); }} onSkip={() => { setLicenseFile(null); setLicenseNumber(''); go('info'); }} />}
      {step === 'info' && terms && <BasicInfo birthDate={terms.birthDate} onNext={(value) => { setBasicInfo(value); go('area'); }} />}
      {step === 'area' && <ActivityArea onNext={(value) => { setAreas(value); go('bank'); }} onSkip={() => { setAreas([]); go('bank'); }} />}
      {step === 'bank' && <BankAccount onNext={handleSubmit} onSkip={() => handleSubmit(null)} submitting={submitting} submitError={submitError} />}
      {step === 'notification' && <NotificationSetup onNext={() => go(completionStep)} />}
      {step === 'review' && <ReviewPending onHome={finishOnboarding} />}
      {step === 'approval' && <Approval role={role} onStart={finishOnboarding} onBrowse={finishOnboarding} />}
      </>}
    </main>
  );
}

export default function OnboardingPage() {
  return <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}><OnboardingInner /></Suspense>;
}
