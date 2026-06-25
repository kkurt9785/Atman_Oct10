'use client';
import { useState } from 'react';
import { Splash } from '@/components/onboarding/Splash';
import { Terms } from '@/components/onboarding/Terms';
import { RoleSelect } from '@/components/onboarding/RoleSelect';
import { ActivityArea } from '@/components/onboarding/ActivityArea';
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

  const go = (s: Step) => setStep(s);

  return (
    <>
      {step === 'splash'   && <Splash onNext={() => go('terms')} />}
      {step === 'terms'    && <Terms onNext={() => go('role')} />}
      {step === 'role'     && <RoleSelect onNext={() => go('area')} />}
      {step === 'area'     && <ActivityArea onNext={() => go('license')} />}
      {step === 'license'  && <LicenseUpload onNext={() => go('id')} onSkip={() => go('id')} />}
      {step === 'id'       && <IDVerification onNext={() => go('bank')} />}
      {step === 'bank'     && <BankAccount onNext={() => go('otp')} />}
      {step === 'otp'      && <OTPVerification onNext={() => go('review')} />}
      {step === 'review'   && <ReviewPending onHome={() => go('approval')} />}
      {step === 'approval' && <Approval onStart={() => go('splash')} onBrowse={() => go('splash')} />}
    </>
  );
}
