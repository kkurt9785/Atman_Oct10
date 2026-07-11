import Link from 'next/link';
import { confirmPaymentOrder } from '@/lib/payment-service';

export const dynamic = 'force-dynamic';

type Result =
  | { ok: true; invoiceId: string; alreadyProcessed: boolean }
  | { ok: false; message: string };

async function confirm(searchParams: { paymentKey?: string; orderId?: string; amount?: string }): Promise<Result> {
  try {
    const amount = Number(searchParams.amount);
    const result = await confirmPaymentOrder({
      paymentKey: searchParams.paymentKey,
      orderId: searchParams.orderId,
      amount,
    });
    return { ok: true, invoiceId: result.invoiceId, alreadyProcessed: result.alreadyProcessed };
  } catch (error) {
    console.error('[membership/success] payment confirmation failed', error);
    return {
      ok: false,
      message: error instanceof Error
        ? error.message
        : '결제 상태를 확인하지 못했어요. 결제 내역을 확인한 뒤 운영팀에 문의해 주세요.',
    };
  }
}

export default async function TossPaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ paymentKey?: string; orderId?: string; amount?: string }>;
}) {
  const result = await confirm(await searchParams);

  return (
    <main className="px-4 min-h-[70vh] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-card p-6 w-full text-center">
        <p className="text-5xl mb-4">{result.ok ? '✅' : '⚠️'}</p>
        <h1 className="text-[22px] font-extrabold text-ink">
          {result.ok ? '서비스 이용료 결제 완료' : '결제 확인 필요'}
        </h1>
        <p className="text-[14px] text-sub mt-2 break-keep">
          {result.ok
            ? `청구서가 결제 완료 처리됐어요${result.alreadyProcessed ? ' (중복 요청은 한 번만 반영됨)' : ''}.`
            : result.message}
        </p>
        <Link href="/membership" className="mt-6 h-12 rounded-xl bg-primary text-white text-[15px] font-bold flex items-center justify-center">
          청구서 확인하기
        </Link>
      </div>
    </main>
  );
}
