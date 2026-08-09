
import { NextRequest, NextResponse } from 'next/server';
import { dispatchPendingNotifications } from '@/lib/notification-dispatch';

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 500 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await dispatchPendingNotifications()) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Dispatch failed' },
      { status: 500 },
    );
  }
}

export const POST = GET;
