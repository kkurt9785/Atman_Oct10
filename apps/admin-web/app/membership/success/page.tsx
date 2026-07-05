import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { adminClient } from '@/lib/supabase';
import { getCurrentFacilityId } from '@/lib/facility';
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

  const facilityId = await getCurrentFacilityId();
  const sb = adminClient();
  if (!sb || !facilityId) return { ok: false, message: '병원 인증 정보가 필요해요.' };

  const { data: existing } = await sb
    .from('credit_ledger')
    .select('id')
    .eq('org_id', facilityId)
    .eq('ref', orderId)
    .maybeSingle();

  if (existing) {
    return { ok: true, credited: tier.credit, alreadyProcessed: true };
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

  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const rows = [
    {
      org_id: facilityId,
      delta: tier.charge,
      kind: 'earn',
      ref: orderId,
      expires_at: expiresAt.toISOString(),
    },
  ];

  if (tier.bonus > 0) {
    rows.push({
      org_id: facilityId,
      delta: tier.bonus,
      kind: 'earn',
      ref: orderId,
      expires_at: expiresAt.toISOString(),
    });
  }

  const { error } = await sb.from('credit_ledger').insert(rows);
  if (error) return { ok: false, message: '결제는 완료됐지만 크레딧 반영에 실패했어요. 운영팀에 문의해 주세요.' };

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
