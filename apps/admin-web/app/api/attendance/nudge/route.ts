import { NextRequest, NextResponse } from 'next/server';
import { adminClient, getUserFromBearer } from '@/lib/supabase';
import { dispatchPendingNotifications } from '@/lib/notification-dispatch';

export const dynamic = 'force-dynamic';
const WORKER_ORIGINS = new Set(['https://itdot.co.kr', 'http://localhost:3003']);
const lastDispatchByUser = new Map<string, number>();

function cors(request: NextRequest) {
  const origin = request.headers.get('origin');
  return origin && WORKER_ORIGINS.has(origin) ? origin : null;
}

export async function OPTIONS(request: NextRequest) {
  const origin = cors(request);
  if (!origin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return new NextResponse(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }});
}

export async function POST(request: NextRequest) {
  const origin = cors(request);
  if (!origin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  const user = await getUserFromBearer(request.headers);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  const sb = adminClient();
  // 단계적 자격검증 직군(rn/na/pharmacist)은 approved가 되지 않으므로
  // 실존 워커라면 통과시킨다 — 지원·채팅 직후 실시간 알림의 유일한 트리거다.
  const { data: worker } = sb ? await sb.from('workers').select('id, role, verification_status')
    .eq('auth_user_id', user.id).is('deleted_at', null).maybeSingle() : { data: null };
  const progressive = worker?.role === 'rn' || worker?.role === 'na' || worker?.role === 'pharmacist';
  if (!worker || (!progressive && worker.verification_status !== 'approved')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
  }
  const now = Date.now();
  if (now - (lastDispatchByUser.get(user.id) ?? 0) < 15_000) {
    return NextResponse.json({ ok: true, throttled: true }, { headers });
  }
  lastDispatchByUser.set(user.id, now);
  try {
    return NextResponse.json({ ok: true, ...(await dispatchPendingNotifications(5)) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Dispatch failed' }, { status: 500, headers });
  }
}
