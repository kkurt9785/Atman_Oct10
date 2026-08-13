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
  const { data: worker } = sb ? await sb.from('workers').select('id').eq('auth_user_id', user.id)
    .eq('verification_status', 'approved').is('deleted_at', null).maybeSingle() : { data: null };
  if (!worker) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
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
