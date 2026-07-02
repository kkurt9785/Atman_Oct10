'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Splash } from '@/components/onboarding/Splash';
import { Terms } from '@/components/onboarding/Terms';
import { RoleSelect } from '@/components/onboarding/RoleSelect';
import { ActivityArea, type AreaPref } from '@/components/onboarding/ActivityArea';
import { LicenseUpload } from '@/components/onboarding/LicenseUpload';
import { IDVerification } from '@/components/onboarding/IDVerification';
import { BankAccount } from '@/components/onboarding/BankAccount';
import type { BankAccountValue } from '@/components/onboarding/BankAccount';
import { OTPVerification } from '@/components/onboarding/OTPVerification';
import { ReviewPending } from '@/components/onboarding/ReviewPending';
import { Approval } from '@/components/onboarding/Approval';

type Step =
  | 'splash'
  | 'terms'
  | 'role'
  | 'area'
  | 'license'
  | 'id'
  | 'bank'
  | 'otp'
  | 'review'
  | 'approval';

const VALID_STEPS = new Set<Step>(['splash', 'terms', 'role', 'area', 'license', 'id', 'bank', 'otp', 'review', 'approval']);

function OnboardingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const param = searchParams.get('step') as Step | null;
  const initial: Step = param && VALID_STEPS.has(param) ? param : 'splash';

  const [step, setStep] = useState<Step>(initial);
  const [role, setRole] = useState<'rn' | 'na' | null>(null);
  const [areas, setAreas] = useState<AreaPref[]>([]);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [bankAccount, setBankAccount] = useState<BankAccountValue | null>(null);

  const go = (s: Step) => setStep(s);

  async function handleOtpNext() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      go('splash');
      return;
    }

    let licensePhotoUrl: string | null = null;
    if (licenseFile) {
      const ext = licenseFile.name.split('.').pop() ?? 'jpg';
      const path = `${user.id}/license.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('license-photos')
        .upload(path, licenseFile, { upsert: true });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('license-photos').getPublicUrl(path);
        licensePhotoUrl = urlData.publicUrl;
      }
    }

    if (role) {
      const nickname = user.user_metadata?.profile_nickname ?? '사용자';
      await supabase.from('workers').upsert({
        auth_user_id: user.id,
        kakao_id: user.app_metadata?.provider === 'kakao'
          ? user.user_metadata?.provider_id ?? user.id
          : user.id,
        name: nickname,
        email: user.email,
        birth_date: '1990-01-01',
        role,
        verification_status: licensePhotoUrl ? 'reviewing' : 'pending',
        license_photo_url: licensePhotoUrl,
      }, { onConflict: 'auth_user_id' });

      if (bankAccount) {
        await supabase.rpc('upsert_my_bank_account', {
          p_bank_code: bankAccount.bankName,
          p_bank_name: bankAccount.bankName,
          p_account_number: bankAccount.accountNumber,
          p_account_holder_name: nickname,
        });
      }
    }

    if (user && areas.length > 0) {
      await supabase.from('worker_location_prefs').upsert({
        worker_id: user.id,
        locations: areas,
      });
      // primary 지역 좌표 → workers.activity_center
      const primary = areas[0];
      if (primary?.lat && primary?.lng) {
        await supabase.from('workers')
          .update({
            activity_center: `SRID=4326;POINT(${primary.lng} ${primary.lat})`,
            activity_radius_meters: primary.radius_km * 1000,
            activity_address_text: primary.label,
          })
          .eq('auth_user_id', user.id);
      }
    }
    await supabase
      .from('profiles')
      .update({ role: 'worker', onboarding_done: true })
      .eq('id', user.id);
    go('review');
  }

  return (
    <>
      {step === 'splash'   && <Splash />}
      {step === 'terms'    && <Terms onNext={() => go('role')} />}
      {step === 'role'     && <RoleSelect onNext={(r) => { setRole(r); go('area'); }} />}
      {step === 'area'     && <ActivityArea onNext={(a) => { setAreas(a); go('license'); }} />}
      {step === 'license'  && <LicenseUpload onNext={(f) => { setLicenseFile(f); go('id'); }} onSkip={() => go('id')} />}
      {step === 'id'       && <IDVerification onNext={() => go('bank')} />}
      {step === 'bank'     && <BankAccount onNext={(b) => { setBankAccount(b); go('otp'); }} />}
      {step === 'otp'      && <OTPVerification onNext={handleOtpNext} />}
      {step === 'review'   && <ReviewPending onHome={() => go('approval')} />}
      {step === 'approval' && <Approval onStart={() => router.push('/shifts')} onBrowse={() => router.push('/shifts')} />}
    </>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
      <OnboardingInner />
    </Suspense>
  );
}
