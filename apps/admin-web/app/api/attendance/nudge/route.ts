import { NextRequest, NextResponse } from 'next/server';
import { getUserFromBearer } from '@/lib/supabase';
import { dispatchPendingNotifications } from '@/lib/notification-dispatch';

export const dynamic = 'force-dynamic';
const WORKER_ORIGINS = new Set(['https://itdot.co.kr', 'http://localhost:3003']);

function cors(request: NextRequest) {
  const origin = request.headers.get('origin');
  return origin && WORKER_ORIGINS.has(origin) ? origin : 'https://itdot.co.kr';
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': cors(request),
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }});
}

export async function POST(request: NextRequest) {
  const headers = { 'Access-Control-Allow-Origin': cors(request), Vary: 'Origin' };
  if (!await getUserFromBearer(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  try {
    return NextResponse.json({ ok: true, ...(await dispatchPendingNotifications(10)) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Dispatch failed' }, { status: 500, headers });
  }
}
