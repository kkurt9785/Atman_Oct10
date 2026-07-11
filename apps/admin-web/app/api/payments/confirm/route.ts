
import { NextRequest, NextResponse } from 'next/server';
import { confirmPaymentOrder } from '@/lib/payment-service';

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '결제 승인에 실패했어요.' },
      { status: 400 },
    );
  }
}
