import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = adminClient();
  if (!sb) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 });
  const { data, error } = await sb.rpc('expire_service_trials');
  if (error) {
    console.error('[cron/expire-trials]', error);
    return NextResponse.json({ error: 'Trial expiration failed' }, { status: 500 });
  }
  const result = { ok: true, expired_trials: Number(data ?? 0) };
  console.log('[cron/expire-trials]', result);
  return NextResponse.json(result);
}

export const POST = GET;
