import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  const body = await request.json().catch(() => ({})) as { email?: unknown };
  const email = typeof body.email === 'string' ? body.email.toLowerCase() : '';
  const password = process.env.DEMO_ACCOUNT_PASSWORD;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!ALLOWED.has(email) || !password || !url || !anon) {
    return NextResponse.json({ error: '데모 로그인을 사용할 수 없어요.' }, { status: 403 });
  }
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return NextResponse.json({ error: '데모 로그인에 실패했어요.' }, { status: 401 });
  }
  return NextResponse.json({
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
