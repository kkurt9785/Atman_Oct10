'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Splash } from '@/components/onboarding/Splash';
import { Terms } from '@/components/onboarding/Terms';
import { RoleSelect } from '@/components/onboarding/RoleSelect';
import { ActivityArea, type AreaPref } from '@/components/onboarding/ActivityArea';
import { LicenseUpload } from '@/components/onboarding/LicenseUpload';
import { IDVerification } from '@/components/onboarding/IDVerification';
import { BankAccount } from '@/components/onboarding/BankAccount';
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

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>('splash');
  const [areas, setAreas] = useState<AreaPref[]>([]);

  const go = (s: Step) => setStep(s);

  async function handleOtpNext() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && areas.length > 0) {
      await supabase.from('worker_location_prefs').upsert({
        worker_id: user.id,
        locations: areas,
      });
    }
    go('review');
  }

  return (
    <>
      {step === 'splash'   && <Splash onNext={() => go('terms')} />}
      {step === 'terms'    && <Terms onNext={() => go('role')} />}
      {step === 'role'     && <RoleSelect onNext={() => go('area')} />}
      {step === 'area'     && <ActivityArea onNext={(a) => { setAreas(a); go('license'); }} />}
      {step === 'license'  && <LicenseUpload onNext={() => go('id')} onSkip={() => go('id')} />}
      {step === 'id'       && <IDVerification onNext={() => go('bank')} />}
      {step === 'bank'     && <BankAccount onNext={() => go('otp')} />}
      {step === 'otp'      && <OTPVerification onNext={handleOtpNext} />}
      {step === 'review'   && <ReviewPending onHome={() => go('approval')} />}
      {step === 'approval' && <Approval onStart={() => go('splash')} onBrowse={() => go('splash')} />}
    </>
  );
}
