import { NextRequest, NextResponse } from 'next/server';
import { reconcilePendingPayments } from '@/lib/payment-service';

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

  try {
    const result = await reconcilePendingPayments(25);
    return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed === 0 ? 200 : 207 });
  } catch (error) {
    console.error('[cron/reconcile-payments]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Payment reconciliation failed' },
      { status: 500 },
    );
  }
}

export const POST = GET;
