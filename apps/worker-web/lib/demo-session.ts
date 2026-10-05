'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { rememberWorkerShell, setGigworkerModePreference } from '@/lib/worker-mode';
import { startKakaoLogin } from '@/lib/kakao-login';

// 시연 계정으로 갈아타기 — 시작 화면 카드, /demo, /gig/demo 가 같이 쓴다.
// 노출은 NEXT_PUBLIC_ENABLE_DEMO_LOGIN 하나로 막는다(출시 때 0이면 카드는 설명만 남는다).
export const DEMO_LOGIN_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === '1';

export const MEDICAL_DEMOS = [
  { email: 'worker-demo-1@demo.atman.co.kr', role: '간호사', detail: '10명 내외 병원 · 요양병원 근무 찾기' },
  { email: 'worker-demo-5@demo.atman.co.kr', role: '간호조무사', detail: '요양병원 근무 찾기' },
  { email: 'worker-demo-6@demo.atman.co.kr', role: '약사', detail: '대체약사 · 주말 약국' },
  { email: 'worker-demo-2@demo.atman.co.kr', role: '약국 전산·사무직', detail: '약국 접수·전산' },
];

export const isDemoEmail = (email: string | null | undefined) => (email ?? '').toLowerCase().endsWith('@demo.atman.co.kr');

// 시연 종류 — 초대 근무 시연은 계정 하나(긱 데모), 나머지는 근무 찾기 시연. 시연이 아니면 false
const GIG_DEMO_EMAIL = 'worker-gig-demo@demo.atman.co.kr';
export type DemoKind = 'gig' | 'medical';
export function demoKindOf(email: string | null | undefined): DemoKind | false {
  if (!isDemoEmail(email)) return false;
  return (email ?? '').toLowerCase() === GIG_DEMO_EMAIL ? 'gig' : 'medical';
}

// 지금 로그인한 계정이 어떤 시연 계정인지 — 로그인·로그아웃에 맞춰 바뀐다(네트워크 없이 저장된 세션만 본다).
// 확인 전에는 null: 일반 계정 화면(로그아웃·탈퇴)이 시연 화면에 잠깐 비치지 않게 한다.
export function useDemoSession() {
  const [demo, setDemo] = useState<DemoKind | false | null>(null);
  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => { if (active) setDemo(demoKindOf(data.session?.user.email)); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setDemo(demoKindOf(session?.user.email)));
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);
  return demo;
}

// 근무 찾기 시연은 고른 직군 계정으로, 초대 근무 시연은 초대 수락부터 시작한다. 이동할 주소를 돌려준다.
export async function openDemoSession(target: { email: string } | 'gig'): Promise<string> {
  const gig = target === 'gig';
  // 다른 계정으로 로그인돼 있어도 시연 계정으로 바꿔 탄다
  await supabase.auth.signOut().catch(() => undefined);
  const response = await fetch('/api/demo-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gig ? { code: 'GIG2026' } : { email: target.email }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.accessToken || !payload.refreshToken || (gig && !payload.gigInviteToken)) {
    throw new Error(payload.error ?? '시연 계정을 열지 못했어요.');
  }
  const { error } = await supabase.auth.setSession({ access_token: payload.accessToken, refresh_token: payload.refreshToken });
  if (error) throw error;
  try {
    window.localStorage.setItem('atman_demo_panel', '1');
    if (!gig) window.localStorage.removeItem('atman_auth_next');
  } catch { /* 저장소 없어도 진행 */ }
  rememberWorkerShell(gig ? 'gig' : 'medical');
  return gig ? `/gig/join?token=${encodeURIComponent(payload.gigInviteToken)}` : '/home';
}

// 시연 계정에서 내리기(이동 없음) — 실제 초대 링크를 열기 전처럼, 다음 화면을 내 계정으로 보게 할 때
export async function leaveDemo() {
  await supabase.auth.signOut().catch(() => undefined);
  setGigworkerModePreference(false);
  try { window.localStorage.removeItem('atman_demo_panel'); } catch { /* 저장소 없어도 진행 */ }
}

// 다른 시연을 보러 시작 화면으로 — 가입으로 가지 않을 때만 쓴다
export async function leaveDemoToStart() {
  await leaveDemo();
  window.location.replace('/');
}

// 시연을 끝내면 바로 카카오 로그인 — 써 보고 마음에 들면 한 번에 내 계정으로 시작한다.
// 카카오톡 안 브라우저는 카카오 로그인을 바깥 브라우저에서 해야 한다 — 시작 화면(?start=1)을 바깥에서 열면 거기서 바로 로그인이 이어진다.
export async function endDemoSession() {
  await leaveDemo();
  // 로그인 뒤 어느 화면으로 갈지는 시작 화면과 같이 데이터가 정한다
  rememberWorkerShell('medical');
  if (navigator.userAgent.includes('KAKAO')) {
    window.location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(`${window.location.origin}/?start=1`);
    return;
  }
  startKakaoLogin();
}
