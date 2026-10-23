
import { NextRequest, NextResponse } from 'next/server';
import { confirmPaymentOrder } from '@/lib/payment-service';
import { DEMO_BLOCKED_MESSAGE } from '@/lib/demo-guard';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    paymentKey?: string;
    orderId?: string;
    amount?: number;
  };

  try {
    const result = await confirmPaymentOrder({
      paymentKey: body.paymentKey,
      orderId: body.orderId,
      amount: Number(body.amount),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '결제 승인에 실패했어요.';
    return NextResponse.json({ error: message }, { status: message === DEMO_BLOCKED_MESSAGE ? 403 : 400 });
  }
}
