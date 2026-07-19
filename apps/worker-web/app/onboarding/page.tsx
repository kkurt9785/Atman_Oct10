'use client';

import { Suspense, useState } from 'react';
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

type Step = 'splash' | 'terms' | 'role' | 'area' | 'license' | 'info' | 'bank' | 'review' | 'approval';
const VALID_STEPS = new Set<Step>(['splash','terms','role','area','license','info','bank','review','approval']);
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const param = searchParams.get('step') as Step | null;
  const [step, setStep] = useState<Step>(param && VALID_STEPS.has(param) ? param : 'splash');
  const [terms, setTerms] = useState<TermsValue | null>(null);
  const [role, setRole] = useState<'rn' | 'na' | null>(null);
  const [areas, setAreas] = useState<AreaPref[]>([]);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licenseNumber, setLicenseNumber] = useState('');
  const [basicInfo, setBasicInfo] = useState<BasicInfoValue | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  async function handleSubmit(bank: BankAccountValue) {
    if (submitting) return;
    if (!terms || !role || areas.length < 1 || !basicInfo) {
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
        if (!ext) throw new Error('지원하지 않는 면허 파일 형식이에요.');
        uploadedPath = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('license-photos').upload(uploadedPath, licenseFile, {
          cacheControl: '3600', upsert: false, contentType: licenseFile.type,
        });
        if (uploadError) throw new Error(`면허 파일 업로드 실패: ${uploadError.message}`);
      }

      const { error: rpcError } = await supabase.rpc('complete_worker_onboarding', {
        p_role: role,
        p_name: basicInfo.name,
        p_phone: basicInfo.phone,
        p_birth_date: terms.birthDate,
        p_areas: areas,
        p_license_path: uploadedPath,
        p_bank_code: bank.bankCode,
        p_bank_name: bank.bankName,
        p_account_number: bank.accountNumber,
        p_account_holder_name: basicInfo.name,
        p_consents: terms.consents,
      });
      if (rpcError) throw new Error(rpcError.message.replace(/^.*?: /, ''));

      // 면허 번호 입력 시: 온보딩 완료 직후 프로필에 반영 (나의 정보와 동일 경로).
      // 실패해도 가입 자체는 유효 — 번호는 나의 정보에서 재등록 가능하므로 흐름을 막지 않는다.
      if (licenseNumber) {
        await supabase.rpc('update_my_worker_profile', {
          p_license_number: licenseNumber,
          p_license_path: uploadedPath,
          p_experience_years: null,
          p_last_workplace: null,
          p_department_tags: [],
        }).then(({ error: profileError }) => {
          if (profileError) console.warn('면허 번호 저장 실패(나의 정보에서 재등록 가능):', profileError.message);
        });
      }

      setStep(licenseFile || licenseNumber ? 'review' : 'approval');
    } catch (error) {
      if (uploadedPath) await supabase.storage.from('license-photos').remove([uploadedPath]).catch(() => undefined);
      setSubmitError(error instanceof Error ? error.message : '가입 정보 저장에 실패했어요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-white">
      {step === 'splash' && <Splash />}
      {step === 'terms' && <Terms onNext={(value) => { setTerms(value); setStep('role'); }} />}
      {step === 'role' && <RoleSelect onNext={(value) => { setRole(value); setStep('area'); }} />}
      {step === 'area' && <ActivityArea onNext={(value) => { setAreas(value); setStep('license'); }} />}
      {step === 'license' && <LicenseUpload onNext={({ file, number }) => { setLicenseFile(file); setLicenseNumber(number); setStep('info'); }} onSkip={() => { setLicenseFile(null); setLicenseNumber(''); setStep('info'); }} />}
      {step === 'info' && terms && <BasicInfo birthDate={terms.birthDate} onNext={(value) => { setBasicInfo(value); setStep('bank'); }} />}
      {step === 'bank' && <BankAccount onNext={handleSubmit} submitting={submitting} submitError={submitError} />}
      {step === 'review' && <ReviewPending onHome={() => router.replace('/home')} />}
      {step === 'approval' && <Approval onStart={() => router.replace('/shifts')} onBrowse={() => router.replace('/shifts')} />}
    </main>
  );
}

export default function OnboardingPage() {
  return <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}><OnboardingInner /></Suspense>;
}
