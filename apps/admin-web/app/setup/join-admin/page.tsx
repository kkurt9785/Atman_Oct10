'use client';

import { Suspense, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase-browser';
import { acceptAdminInviteResult, previewAdminInviteResult } from '@/lib/actions/facility';

const PENDING_KEY = 'itdot:pending-admin-invite';

type View =
  | { step: 'loading' }
  | { step: 'login' }
  | { step: 'ready'; facilityName: string; alreadyMember: boolean }
  | { step: 'error'; message: string };

// 소유자가 보낸 '운영 관리자 초대 링크'를 여는 화면. 로그인 전이면 링크를 기억해 두고 로그인 뒤에 다시 잇는다(auth/callback).
function JoinAdmin() {
  const token = useSearchParams().get('t') ?? '';
  const [view, setView] = useState<View>({ step: 'loading' });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      if (!token) { setView({ step: 'error', message: '초대 링크가 올바르지 않아요. 받은 링크를 다시 눌러 주세요.' }); return; }
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      const synced = accessToken
        ? await fetch('/api/admin-session', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }).then((res) => res.ok).catch(() => false)
        : false;
      if (!active) return;
      if (!synced) {
        try { window.localStorage.setItem(PENDING_KEY, token); } catch {}
        setView({ step: 'login' });
        return;
      }
      try { window.localStorage.removeItem(PENDING_KEY); } catch {}
      const result = await previewAdminInviteResult(token).catch(() => null);
      if (!active) return;
      if (!result?.ok) { setView({ step: 'error', message: result?.error ?? '초대를 확인하지 못했어요. 잠시 후 다시 열어 주세요.' }); return; }
      setView({ step: 'ready', ...result.data });
    }
    void load();
    return () => { active = false; };
  }, [token]);

  function accept() {
    setError('');
    startTransition(async () => {
      const result = await acceptAdminInviteResult(token).catch(() => null);
      if (!result?.ok) { setError(result?.error ?? '참여하지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
      window.location.replace('/');
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center">
        <p className="text-[0.8125rem] font-bold text-primary">관리자 초대</p>
        {view.step === 'loading' && <p className="mt-3 text-[0.875rem] text-sub" aria-busy="true">초대를 확인하고 있어요…</p>}

        {view.step === 'login' && <>
          <h1 className="mt-2 text-[1.25rem] font-extrabold text-ink">먼저 로그인해 주세요</h1>
          <p className="mt-2 text-[0.875rem] leading-6 text-sub">관리자 앱에 로그인(처음이면 가입)하면 이 초대로 바로 이어져요. 사업장을 새로 등록할 필요는 없어요.</p>
          <Link href="/login" className="mt-5 flex h-12 items-center justify-center rounded-xl bg-primary text-[0.9375rem] font-bold text-white">로그인하러 가기</Link>
        </>}

        {view.step === 'ready' && <>
          <h1 className="mt-2 text-[1.25rem] font-extrabold text-ink">{view.facilityName}</h1>
          <p className="mt-2 text-[0.875rem] leading-6 text-sub">{view.alreadyMember
            ? '이미 이 사업장의 관리자예요. 바로 들어갈 수 있어요.'
            : '운영 관리자로 참여하면 직원·출퇴근·휴가·공고를 함께 관리할 수 있어요. 급여는 소유자가 허용해야 보여요.'}</p>
          <button type="button" disabled={isPending} onClick={accept} className="mt-5 h-12 w-full rounded-xl bg-primary text-[0.9375rem] font-bold text-white disabled:opacity-60">{isPending ? '들어가는 중…' : view.alreadyMember ? '사업장으로 들어가기' : '운영 관리자로 참여하기'}</button>
          {error && <p role="alert" className="mt-3 text-[0.8125rem] font-bold text-warn">{error}</p>}
        </>}

        {view.step === 'error' && <>
          <h1 className="mt-2 text-[1.125rem] font-extrabold text-ink">초대를 열 수 없어요</h1>
          <p role="alert" className="mt-2 text-[0.875rem] leading-6 text-sub">{view.message}</p>
          <Link href="/" className="mt-5 flex h-12 items-center justify-center rounded-xl border border-line bg-white text-[0.9375rem] font-bold text-ink">관리자 앱으로 가기</Link>
        </>}
      </div>
    </div>
  );
}

export default function JoinAdminPage() {
  return <Suspense fallback={null}><JoinAdmin /></Suspense>;
}
