
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { reconcilePaymentFromProvider } from '@/lib/payment-service';
import { getTossPayment } from '@/lib/toss';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: NextRequest): boolean {
  const expected = process.env.TOSS_WEBHOOK_TOKEN;
  if (!expected || expected.length < 24) return false;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const header = request.headers.get('x-atman-webhook-token') ?? '';
  const query = request.nextUrl.searchParams.get('token') ?? '';
  return [bearer, header, query].some((candidate) => candidate && safeEqual(candidate, expected));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const data = (body?.data && typeof body.data === 'object'
    ? body.data
    : body) as Record<string, unknown> | null;
  const paymentKey = typeof data?.paymentKey === 'string' ? data.paymentKey : null;
  if (!paymentKey) {
    return NextResponse.json({ error: 'paymentKey required' }, { status: 400 });
  }

  try {
    // Webhook bodies are notifications, not settlement authority. Re-fetch from Toss.
    const payment = await getTossPayment(paymentKey);
    await reconcilePaymentFromProvider(payment);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[payments/webhook]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Webhook processing failed' },
      { status: 500 },
    );
  }
}
