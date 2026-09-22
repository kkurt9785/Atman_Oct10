'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  getFacilityRegistrationSources,
  getGigworkerModePreference,
  setGigworkerModePreference,
  shouldUseGigworkerMode,
} from '@/lib/worker-mode';

function RootInner() {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    async function route() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSignedOut(true);
        return;
      }
      const [{ data: profile }, { data: staffLinks }, { data: worker }] = await Promise.all([
        supabase.from('profiles').select('onboarding_done').single(),
        supabase.from('facility_staff').select('facilities(registration_source)').neq('status', 'ended'),
        supabase.from('workers').select('role').eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle(),
      ]);
      if (profile?.onboarding_done) {
        const sources = getFacilityRegistrationSources(staffLinks);
        const gigworkerMode = shouldUseGigworkerMode(sources, worker?.role, getGigworkerModePreference());
        if (gigworkerMode) setGigworkerModePreference(true);
        router.replace(gigworkerMode ? '/workplace' : '/home');
      } else {
        router.replace('/onboarding?step=terms');
      }
    }
    route();
  }, [router]);

  function openInvite() {
    setInviteError('');
    const value = inviteLink.trim();
    const directToken = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? value : null;
    let token = directToken;
    if (!token) {
      try { token = new URL(value).searchParams.get('token'); } catch { token = null; }
    }
    if (!token) {
      setInviteError('관리자가 보낸 초대 링크 전체를 붙여 넣어 주세요.');
      return;
    }
    setGigworkerModePreference(true);
    router.push(`/workplace/join?token=${encodeURIComponent(token)}`);
  }

  if (signedOut) return <main className="min-h-screen bg-gradient-to-b from-primary/10 via-bg to-bg px-5 pb-12 pt-14">
    <div className="mx-auto max-w-md">
      <p className="text-[25px] font-extrabold tracking-[-0.8px] text-primary">잇닿 <span className="text-ink">WORKER</span></p>
      <p className="mt-2 text-[14px] text-sub">초대받은 출퇴근과 병원·약국 일자리 찾기를 분리했어요.</p>
      <h1 className="mt-9 text-[28px] font-extrabold leading-tight text-ink">어떻게 시작할까요?</h1>

      <section className="mt-5 rounded-3xl bg-ink p-5 text-white shadow-btn">
        <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.12em]">GIG WORKER</span>
        <h2 className="mt-4 text-[21px] font-extrabold">근무 초대를 받았어요</h2>
        <p className="mt-1 text-[13px] leading-5 text-white/70">당근 등에서 구한 단기근무라면 관리자가 보낸 링크로 근무조건을 확인하고 출퇴근만 기록해요.</p>
        <div className="mt-4 rounded-2xl bg-white/10 p-2">
          <input value={inviteLink} onChange={(event) => setInviteLink(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && openInvite()} placeholder="초대 링크 붙여넣기" className="h-12 w-full rounded-xl bg-white px-3 text-[14px] text-ink outline-none placeholder:text-tertiary" />
          <button type="button" onClick={openInvite} className="mt-2 h-11 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white">긱워커 근태 시작</button>
        </div>
        {inviteError && <p role="alert" className="mt-2 text-[12px] font-bold text-red-300">{inviteError}</p>}
        <p className="mt-3 text-[11px] text-white/55">카카오톡·문자에서 초대 링크를 바로 눌러도 이 화면 없이 연결됩니다.</p>
      </section>

      <Link href="/onboarding" className="mt-4 block rounded-3xl border border-line bg-white p-5 shadow-sm active:bg-bg">
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-extrabold tracking-[0.1em] text-primary">MEDICAL SHIFT</span>
        <h2 className="mt-4 text-[20px] font-extrabold text-ink">병원·약국 근무를 찾고 싶어요</h2>
        <p className="mt-1 text-[13px] leading-5 text-sub">간호사·간호조무사·약사·약국사무직으로 등록하고 일자리를 찾아요.</p>
        <p className="mt-4 text-right text-[13px] font-extrabold text-primary">워커 등록하기 →</p>
      </Link>
    </div>
  </main>;

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
