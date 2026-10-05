'use client';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// 로그인 여부 확인 — 신호가 약한 근무지에서 getUser 가 한 번 실패했다고 로그인 화면으로 보내지 않는다.
// 서버가 세션을 거부했을 때(401·403)나 저장된 세션이 없을 때만 로그아웃으로 본다. 일시적 실패는 한 번 더 확인한다.
export async function getSignedInUser(): Promise<User | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (user) return user;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || status === 403) return null;
  await new Promise((resolve) => setTimeout(resolve, 700));
  const retry = await supabase.auth.getUser();
  if (retry.data.user) return retry.data.user;
  const retryStatus = (retry.error as { status?: number } | null)?.status;
  return retryStatus === 401 || retryStatus === 403 ? null : session.user;
}
