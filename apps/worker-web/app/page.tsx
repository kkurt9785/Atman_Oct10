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
        router.replace('/shifts');
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
    <WorkerEntrySkeleton />
  );
}

function WorkerEntrySkeleton() {
  return (
    <main className="min-h-screen bg-bg px-5 pt-16" aria-busy="true" aria-label="맞춤 시프트를 준비하는 중">
      <p className="text-[24px] font-extrabold text-primary">잇닿</p>
      <div className="mt-8 h-4 w-28 animate-pulse rounded-full bg-primary/10" />
      <div className="mt-3 h-8 w-64 max-w-full animate-pulse rounded-xl bg-line" />
      <div className="mt-6 h-24 animate-pulse rounded-2xl bg-white shadow-card" />
      <div className="mt-4 space-y-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-2xl bg-white shadow-card" />
        ))}
      </div>
      <span className="sr-only">내 조건에 맞는 시프트를 확인하고 있어요.</span>
    </main>
  );
}

export default function Root() {
  return (
    <Suspense fallback={<WorkerEntrySkeleton />}>
      <RootInner />
    </Suspense>
  );
}
