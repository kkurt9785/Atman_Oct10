import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase';
import { DENTAL_DEMO_EMAIL, ensureDentalDemoAccount, isValidDentalDemoKey } from '@/lib/demo/private-dental';

const ALLOWED = new Set([
  'sales-demo-1@demo.atman.co.kr',
  'sales-demo-2@demo.atman.co.kr',
  'sales-demo-3@demo.atman.co.kr',
]);
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(request: NextRequest) {
  const key = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 10;
}

export async function POST(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN !== '1') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (rateLimited(request)) {
    return NextResponse.json({ error: '잠시 후 다시 시도해 주세요.' }, { status: 429 });
  }
  const body = await request.json().catch(() => ({})) as { email?: unknown; demoKind?: unknown; key?: unknown };
  // 비공개 치과 시연은 이메일이 아니라 숨은 링크의 키로 들어온다 — 키가 맞을 때만 그 계정으로 로그인한다
  const dental = body.demoKind === 'dental';
  if (dental && !isValidDentalDemoKey(body.key)) {
    return NextResponse.json({ error: '시연 링크가 만료됐거나 올바르지 않아요. 담당자에게 새 링크를 받아 주세요.' }, { status: 403 });
  }
  const email = dental ? DENTAL_DEMO_EMAIL : typeof body.email === 'string' ? body.email.toLowerCase() : '';
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if ((!dental && !ALLOWED.has(email)) || !password || !url || !anon) {
    return NextResponse.json({ error: '데모 로그인을 사용할 수 없어요.' }, { status: 403 });
  }
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  let { data, error } = await client.auth.signInWithPassword({ email, password });
  // 치과 시연 원장 계정은 첫 로그인 때 만든다(매일 아침 되살리기를 기다리지 않게). 이후엔 접근 권한만 다시 보장한다.
  if (dental && (error || !data.session)) {
    if (await ensureDentalDemoAccount()) ({ data, error } = await client.auth.signInWithPassword({ email, password }));
  }
  if (error || !data.session) {
    return NextResponse.json({ error: '데모 로그인에 실패했어요.' }, { status: 401 });
  }
  // 시연 대화·알림을 지금 시각 기준으로 다시 만든다 — 앞사람이 대화를 읽어 '대화' 숫자가 사라진 채로 다음 사람이 보지 않게.
  // 2.5초 안에 안 끝나거나 실패해도 로그인은 그대로 진행한다.
  try {
    const service = adminClient();
    if (service && data.user && dental) {
      // 오늘 근태를 지금 시각 기준으로(아침 8시 반에 만든 '출근 전'이 낮 시연에 그대로 보이지 않게)
      await Promise.race([service.rpc('refresh_demo_dental_today'), new Promise((resolve) => setTimeout(resolve, 2500))]);
    }
    if (service && data.user) await Promise.race([service.rpc('seed_demo_workrooms_for', { p_user: data.user.id }), new Promise((resolve) => setTimeout(resolve, 2500))]);
  } catch { /* 시연 대화가 어제 것으로 보일 뿐 */ }
  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
