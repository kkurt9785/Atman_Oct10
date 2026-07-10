import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { adminClient } from '@/lib/supabase';
import { requireFacilityAdmin } from '@/lib/facility';
import { findCreditTierByCharge, won } from '@/lib/billing';

export const dynamic = 'force-dynamic';

type ConfirmResult =
  | { ok: true; credited: number; alreadyProcessed: boolean }
  | { ok: false; message: string };

async function confirmPayment(searchParams: {
  paymentKey?: string;
  orderId?: string;
  amount?: string;
}): Promise<ConfirmResult> {
  const paymentKey = searchParams.paymentKey;
  const orderId = searchParams.orderId;
  const amount = Number(searchParams.amount);
  const tier = findCreditTierByCharge(amount);

  if (!paymentKey || !orderId || !Number.isFinite(amount) || !tier) {
    return { ok: false, message: '결제 정보가 올바르지 않아요.' };
  }

  const secretKey = process.env.TOSS_SECRET_KEY;
  if (!secretKey) {
    return { ok: false, message: 'TOSS_SECRET_KEY가 설정되지 않았어요.' };
  }

  const session = await requireFacilityAdmin();
  const sb = adminClient();
  if (!sb || !session) return { ok: false, message: '병원 인증 정보가 필요해요.' };

  // 주문 원장 검증 — 결제 전 생성된 주문이 있어야만 승인 진행
  const { data: order } = await sb
    .from('payment_orders')
    .select('order_id, org_id, amount, status')
    .eq('order_id', orderId)
    .maybeSingle();

  if (!order || order.org_id !== session.facilityId) {
    return { ok: false, message: '주문 정보를 찾을 수 없어요.' };
  }
  if (order.status === 'paid') {
    return { ok: true, credited: tier.credit, alreadyProcessed: true };
  }
  if (order.amount !== amount) {
    return { ok: false, message: '결제 금액이 주문과 달라요.' };
  }

  const res = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    return {
      ok: false,
      message: body?.message ?? '결제 승인에 실패했어요.',
    };
  }

  // 크레딧 지급 — 단일 트랜잭션·멱등 RPC (원장 기록 + 주문 paid 전환 + 감사로그)
  const { data: applied, error } = await sb.rpc('apply_payment_credit', {
    p_order_id: orderId,
    p_payment_key: paymentKey,
    p_amount: amount,
  });
  const appliedResult = applied as { ok: boolean; already?: boolean; credited?: number; message?: string } | null;
  if (error || !appliedResult?.ok) {
    return { ok: false, message: appliedResult?.message ?? '결제는 완료됐지만 크레딧 반영에 실패했어요. 운영팀에 문의해 주세요.' };
  }
  if (appliedResult.already) {
    return { ok: true, credited: tier.credit, alreadyProcessed: true };
  }

  revalidatePath('/');
  revalidatePath('/membership');

  return { ok: true, credited: tier.credit, alreadyProcessed: false };
}

export default async function TossPaymentSuccessPage({
  searchParams,
}: {
  searchParams: { paymentKey?: string; orderId?: string; amount?: string };
}) {
  const result = await confirmPayment(searchParams);

  return (
    <main className="px-4 min-h-[70vh] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-card p-6 w-full text-center">
        <p className="text-5xl mb-4">{result.ok ? '✅' : '⚠️'}</p>
        <h1 className="text-[22px] font-extrabold text-ink">
          {result.ok ? '크레딧 충전 완료' : '결제 확인 필요'}
        </h1>
        <p className="text-[14px] text-sub mt-2">
          {result.ok
            ? `${won(result.credited)} 크레딧이 반영됐어요${result.alreadyProcessed ? ' (이미 처리된 결제)' : ''}.`
            : result.message}
        </p>
        <Link
          href="/membership"
          className="mt-6 h-12 rounded-xl bg-primary text-white text-[15px] font-bold flex items-center justify-center"
        >
          크레딧 확인하기
        </Link>
      </div>
    </main>
  );
}
