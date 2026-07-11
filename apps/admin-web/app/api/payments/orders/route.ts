
import { NextRequest, NextResponse } from 'next/server';
import { createPaymentOrder } from '@/lib/payment-service';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { tierId?: unknown };
  const tierId = typeof body.tierId === 'number' ? body.tierId : Number(body.tierId);
  if (!Number.isInteger(tierId)) {
    return NextResponse.json({ error: 'tierId required' }, { status: 400 });
  }

  try {
    const order = await createPaymentOrder(tierId);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '주문 생성에 실패했어요.';
    const status = /로그인|권한|계정/.test(message) ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
