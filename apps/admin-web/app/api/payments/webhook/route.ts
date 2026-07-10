import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// 토스페이먼츠 웹훅 — 결제 상태의 최종 진실.
// 바디를 신뢰하지 않고 paymentKey로 토스 API를 역조회해 검증한 뒤,
// 멱등 RPC(apply_payment_credit)로 크레딧을 반영한다 (redirect 유실 대비).
export async function POST(req: NextRequest) {
  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) return NextResponse.json({ ok: false }, { status: 500 });

  const body = (await req.json().catch(() => null)) as {
    eventType?: string;
    data?: { paymentKey?: string; orderId?: string; status?: string };
  } | null;

  const paymentKey = body?.data?.paymentKey;
  const orderId = body?.data?.orderId;
  if (!paymentKey || !orderId) return NextResponse.json({ ok: true }); // 무관한 이벤트는 200으로 종료

  // 소스 오브 트루스: 토스 API 역조회 (위조 웹훅 무력화)
  const res = await fetch(`https://api.tosspayments.com/v1/payments/${paymentKey}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}` },
    cache: 'no-store',
  });
  if (!res.ok) return NextResponse.json({ ok: true });

  const payment = (await res.json()) as { orderId?: string; status?: string; totalAmount?: number };
  if (payment.orderId !== orderId || payment.status !== 'DONE' || !payment.totalAmount) {
    return NextResponse.json({ ok: true });
  }

  const sb = adminClient();
  if (!sb) return NextResponse.json({ ok: false }, { status: 500 });

  // 멱등 — 이미 redirect 흐름에서 처리됐으면 already:true로 끝남
  await sb.rpc('apply_payment_credit', {
    p_order_id: orderId,
    p_payment_key: paymentKey,
    p_amount: payment.totalAmount,
  });

  return NextResponse.json({ ok: true });
}
