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
    if (user) {
      await supabase
        .from('profiles')
        .update({ onboarding_done: true })
        .eq('id', user.id);
    }
    go('review');
  }

  return (
    <>
      {step === 'splash'   && <Splash />}
      {step === 'terms'    && <Terms onNext={() => go('role')} />}
      {step === 'role'     && <RoleSelect onNext={() => go('area')} />}
      {step === 'area'     && <ActivityArea onNext={(a) => { setAreas(a); go('license'); }} />}
      {step === 'license'  && <LicenseUpload onNext={() => go('id')} onSkip={() => go('id')} />}
      {step === 'id'       && <IDVerification onNext={() => go('bank')} />}
      {step === 'bank'     && <BankAccount onNext={() => go('otp')} />}
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
