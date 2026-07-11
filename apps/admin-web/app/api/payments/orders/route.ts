
import { NextRequest, NextResponse } from 'next/server';
import { createPaymentOrder } from '@/lib/payment-service';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { invoiceId?: unknown };
  const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId : '';
  if (!invoiceId) {
    return NextResponse.json({ error: 'invoiceId required' }, { status: 400 });
  }

  try {
    const order = await createPaymentOrder(invoiceId);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '주문 생성에 실패했어요.';
    const status = /로그인|권한|계정/.test(message) ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
