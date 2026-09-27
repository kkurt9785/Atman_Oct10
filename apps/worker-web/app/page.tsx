'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { loadWorkerShellContext, rememberWorkerShell, WORKER_SHELL_HOME } from '@/lib/worker-mode';
import { WeekRoster } from '@/components/roster/WeekRoster';
import { Wordmark } from '@/components/brand/BrandMark';
import { KakaoGlyph, startKakaoLogin } from '@/lib/kakao-login';
import { addCount, cellKey, currentWeek, defaultSelection, slotOf, SLOT_NAME, type RosterCells, type RosterSlot } from '@/lib/roster';
import { roleLabel, type PublicShift } from '@/lib/public-jobs';

// 로그인 전 첫 화면 = "이번 주 내 근무표". 간호사가 매일 보는 D·E·N 근무표를 그대로 쓴다.
// 빈 칸에 공개 근무 수가 보이고, 칸을 누르면 그 시간대 근무가 바로 열린다 — 가치까지 1탭, 시작(카카오)까지 1탭.
// 초대받은 긱워커는 링크로 들어오므로 여기서는 작은 진입 하나만 둔다.

function RootInner() {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [shifts, setShifts] = useState<PublicShift[]>([]);
  const [shiftsLoaded, setShiftsLoaded] = useState(false);
  const [selected, setSelected] = useState<{ date: string; slot: RosterSlot } | null>(null);
  // 시연 진입은 ?demo=1 로 연 기기에서만 보인다. 실사용자 첫 화면에 데모를 노출하지 않는다.
  const [demoUnlocked, setDemoUnlocked] = useState(false);

  const week = useMemo(() => currentWeek(), []);

  useEffect(() => {
    const wants = new URLSearchParams(window.location.search).get('demo') === '1';
    if (wants) window.localStorage.setItem('atman_demo_panel', '1');
    setDemoUnlocked(process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1' && (wants || window.localStorage.getItem('atman_demo_panel') === '1'));
  }, []);

  useEffect(() => {
    async function route() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSignedOut(true);
        return;
      }
      const [{ data: profile }, context] = await Promise.all([
        supabase.from('profiles').select('onboarding_done').single(),
        loadWorkerShellContext(user).catch(() => null),
      ]);
      if (profile?.onboarding_done) {
        // 긱 근무지만 있으면 /gig, 의료 쪽만 있으면 /home, 둘 다면 마지막에 쓴 셸 — 규칙은 lib/worker-mode.ts 하나에 있다
        router.replace(WORKER_SHELL_HOME[context?.shell ?? 'medical']);
      } else {
        router.replace('/onboarding?step=terms');
      }
    }
    route();
  }, [router]);

  // 공개 공고(list_public_shifts)는 로그인 없이 읽힌다. 이번 주 것만 근무표에 올린다.
  useEffect(() => {
    if (!signedOut) return;
    let active = true;
    void (async () => {
      const { data } = await supabase.rpc('list_public_shifts', { p_limit: 200 });
      if (!active) return;
      const first = week[0].date, last = week[6].date;
      setShifts(((data ?? []) as PublicShift[]).filter((row) => row.shift_date >= first && row.shift_date <= last));
      setShiftsLoaded(true);
    })();
    return () => { active = false; };
  }, [signedOut, week]);

  const cells = useMemo(() => {
    const next: RosterCells = {};
    for (const shift of shifts) addCount(next, shift.shift_date, shift.start_time);
    return next;
  }, [shifts]);

  useEffect(() => {
    if (shiftsLoaded && !selected) setSelected(defaultSelection(week, cells));
  }, [shiftsLoaded, selected, week, cells]);

  const selectedShifts = useMemo(() => {
    if (!selected) return [];
    return shifts.filter((shift) => shift.shift_date === selected.date && slotOf(shift.start_time) === selected.slot).slice(0, 3);
  }, [shifts, selected]);
  const selectedDay = week.find((day) => day.date === selected?.date);
  const selectedCount = selected ? cells[cellKey(selected.date, selected.slot)]?.count ?? 0 : 0;

  // 긱워커 두 기기 시연: worker-demo-4 로 로그인하고 데모 근무지의 초대(토큰 고정)를 매번 초기화해 /gig/join 으로 간다.
  // 관리자 앱 '긱워커 근태 시연'의 팝업스토어 데모 근무지와 같은 초대라, 관리자 화면에서 복사한 링크·QR 도 이 계정으로 그대로 열린다.
  async function startGigDemo() {
    setInviteError('');
    setInviteLoading(true);
    try {
      const response = await fetch('/api/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'GIG2026' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.accessToken || !payload.refreshToken || !payload.gigInviteToken) {
        throw new Error(payload.error ?? '긱워커 데모를 열지 못했어요.');
      }
      const { error } = await supabase.auth.setSession({
        access_token: payload.accessToken,
        refresh_token: payload.refreshToken,
      });
      if (error) throw error;
      rememberWorkerShell('gig');
      router.replace(`/gig/join?token=${encodeURIComponent(payload.gigInviteToken)}`);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : '긱워커 데모를 열지 못했어요.');
    } finally {
      setInviteLoading(false);
    }
  }

  async function openInvite() {
    setInviteError('');
    const value = inviteLink.trim();
    if (demoUnlocked && value.toUpperCase() === 'GIG2026') {
      await startGigDemo();
      return;
    }
    const directToken = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value) ? value : null;
    let token = directToken;
    if (!token) {
      try { token = new URL(value).searchParams.get('token'); } catch { token = null; }
    }
    if (!token) {
      setInviteError('관리자가 보낸 초대 링크 전체를 붙여 넣어 주세요.');
      return;
    }
    rememberWorkerShell('gig');
    router.push(`/gig/join?token=${encodeURIComponent(token)}`);
  }

  if (!signedOut) return <WorkerEntrySkeleton />;

  return <main className="min-h-screen bg-white px-5 pb-10 pt-14">
    <div className="mx-auto flex min-h-[calc(100vh-96px)] max-w-md flex-col">
      <div className="flex items-center justify-between">
        <Wordmark size={20} />
        <span className="rounded-full border border-line px-3 py-1.5 text-[12px] font-bold text-sub">이번 주 공개 근무</span>
      </div>

      <h1 className="mt-7 text-[26px] font-extrabold leading-tight tracking-[-0.8px] text-ink">이번 주 내 근무표,<br /><span className="text-primary">빈 칸</span>을 채워 볼까요?</h1>
      <p className="mt-2 text-[13px] text-sub">칸을 누르면 그 시간대에 갈 수 있는 근무가 보여요.</p>

      <div className="mt-5">
        <WeekRoster week={week} cells={cells} selected={selected} onSelect={(date, slot) => setSelected({ date, slot })} />
      </div>

      <section className="mt-4 flex flex-col gap-2.5" aria-live="polite">
        {selected && selectedDay && (
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-extrabold text-ink">{selectedDay.isToday ? '오늘' : `${selectedDay.weekday}요일`} {selected.slot} · {SLOT_NAME[selected.slot]} 근무</span>
            <span className="text-[12px] font-bold text-tertiary">{shiftsLoaded ? `${selectedCount}건` : '불러오는 중'}</span>
          </div>
        )}
        {shiftsLoaded && selectedShifts.length === 0 && (
          <div className="rounded-2xl bg-bg px-4 py-5 text-center">
            <p className="text-[14px] font-bold text-ink">이 시간대엔 아직 공개 근무가 없어요</p>
            <p className="mt-1 text-[12px] text-sub">등록해 두면 내 직군·지역의 새 근무를 바로 알려드려요.</p>
          </div>
        )}
        {selectedShifts.map((shift) => (
          <Link key={shift.id} href={`/jobs/${shift.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3.5 active:bg-bg">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[12px] text-tertiary">{shift.facility_name}{shift.region ? ` · ${shift.region}` : ''}</span>
              <span className="text-[15px] font-extrabold text-ink">{shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)} · {roleLabel(shift.required_role)}</span>
            </span>
            <span className="shrink-0 text-[14px] font-extrabold text-primary">시급 {shift.hourly_wage.toLocaleString('ko-KR')}원</span>
          </Link>
        ))}
        {selectedCount > 3 && <Link href="/shifts" className="text-center text-[12px] font-bold text-primary">근무 {selectedCount}건 모두 보기 →</Link>}
      </section>

      <div className="flex-grow" />

      <button type="button" onClick={startKakaoLogin} className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-btn bg-kakao text-[16px] font-extrabold text-ink shadow-btn active:opacity-80">
        <KakaoGlyph />카카오로 시작하고 빈 칸 채우기
      </button>
      {demoUnlocked && (
        <button type="button" onClick={() => void startGigDemo()} disabled={inviteLoading} className="mt-2 flex h-11 w-full items-center justify-between rounded-xl bg-ink px-4 text-[13px] font-extrabold text-white disabled:opacity-60">
          <span>긱워커 시연 시작 <span className="font-normal text-white/60">· 팝업스토어 데모 초대</span></span><span>→</span>
        </button>
      )}
      <button type="button" onClick={() => setInviteOpen((open) => !open)} aria-expanded={inviteOpen} className="mt-2 flex h-10 w-full items-center justify-center text-[13px] font-bold text-sub">
        관리자에게 초대 링크를 받았어요 <span className="ml-1 text-primary">{inviteOpen ? '↑' : '→'}</span>
      </button>
      {inviteOpen && (
        <div className="rounded-2xl bg-bg p-2">
          <input value={inviteLink} onChange={(event) => setInviteLink(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void openInvite()} placeholder="초대 링크 붙여넣기" aria-label="초대 링크" className="h-12 w-full rounded-xl bg-white px-3 text-[14px] text-ink outline-none placeholder:text-tertiary" />
          <button type="button" onClick={() => void openInvite()} disabled={inviteLoading} className="mt-2 h-11 w-full rounded-xl bg-primary text-[14px] font-extrabold text-white disabled:opacity-60">초대 확인하기</button>
          <p className="mt-2 px-1 text-[11px] text-sub">카카오톡·문자의 초대 링크를 바로 눌러도 이 화면 없이 연결됩니다.</p>
        </div>
      )}
      {inviteError && <p role="alert" className="mt-2 text-center text-[12px] font-bold text-red-600">{inviteError}</p>}
    </div>
  </main>;
}

function WorkerEntrySkeleton() {
  return (
    <main className="min-h-screen bg-white px-5 pt-14" aria-busy="true" aria-label="근무표를 준비하는 중">
      <Wordmark size={20} />
      <div className="mt-8 h-8 w-64 max-w-full animate-pulse rounded-xl bg-line" />
      <div className="mt-3 h-4 w-40 animate-pulse rounded-full bg-line" />
      <div className="mt-6 h-44 animate-pulse rounded-2xl bg-bg" />
      <div className="mt-4 space-y-3">
        {[0, 1].map((item) => (
          <div key={item} className="h-16 animate-pulse rounded-2xl bg-bg" />
        ))}
      </div>
      <span className="sr-only">이번 주 근무표를 확인하고 있어요.</span>
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
