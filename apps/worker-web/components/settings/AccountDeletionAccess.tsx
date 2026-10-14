'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { startKakaoLogin } from '@/lib/kakao-login';

export function AccountDeletionAccess() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function continueToDeletion() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) { router.push('/settings/withdraw'); return; }
      window.localStorage.setItem('atman_auth_next', '/settings/withdraw');
      startKakaoLogin();
    } catch {
      setError('로그인을 시작하지 못했어요. 인터넷 연결과 브라우저 저장소 설정을 확인한 뒤 다시 시도해 주세요.');
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <>
    <button type="button" onClick={() => void continueToDeletion()} disabled={busy}
      className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-[15px] font-bold text-white disabled:opacity-60">
      {busy ? '본인 계정 확인 중…' : '본인 계정 확인하고 삭제하기'}
    </button>
    {error && <p role="alert" className="mt-3 text-[14px] text-red-600">{error}</p>}
  </>;
}
