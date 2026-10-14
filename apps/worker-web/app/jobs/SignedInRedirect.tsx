'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// 공개 공고 목록은 검색 유입용(탭바·뒤로 없음) — 이미 로그인한 근무자는 지원까지 되는 근무 찾기로 보낸다
export function SignedInRedirect() {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => { if (active && data.session) router.replace('/shifts'); });
    return () => { active = false; };
  }, [router]);
  return null;
}
