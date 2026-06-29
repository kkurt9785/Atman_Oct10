'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function RootInner() {
  const router = useRouter();

  useEffect(() => {
    async function route() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/onboarding');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_done')
        .single();
      if (profile?.onboarding_done) {
        router.replace('/home');
      } else {
        router.replace('/onboarding?step=terms');
      }
    }
    route();
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function Root() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <RootInner />
    </Suspense>
  );
}
