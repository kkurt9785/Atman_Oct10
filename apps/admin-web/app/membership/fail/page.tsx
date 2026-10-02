import Link from 'next/link';
import { markPaymentFailure } from '@/lib/payment-service';

export const dynamic = 'force-dynamic';

export default async function TossPaymentFailPage({
  searchParams,
}: {
  searchParams: Promise<{ localOrderId?: string; orderId?: string; code?: string }>;
}) {
  const params = await searchParams;
  await markPaymentFailure({
    orderId: params.localOrderId ?? params.orderId,
    code: params.code,
    message: '결제창에서 결제가 끝나지 않았어요.',
  });

  return (
    <main className="px-4 min-h-[70vh] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-card p-6 w-full text-center">
        <p className="text-5xl mb-4">⚠️</p>
        <h1 className="text-[1.375rem] font-extrabold text-ink">결제가 완료되지 않았어요</h1>
        <p className="text-[0.875rem] text-sub mt-2 leading-6">카드 승인 문자를 받았다면 중복 결제하지 말고 청구서 상태를 먼저 확인해 주세요. 승인 내역이 없다면 같은 청구서에서 다시 시도할 수 있어요.</p>
        {params.code && <p className="text-[0.6875rem] text-tertiary mt-2 font-mono">오류 코드: {params.code.slice(0, 80)}</p>}
        <Link href="/membership" className="mt-6 h-12 rounded-xl bg-primary text-white text-[0.9375rem] font-bold flex items-center justify-center">
          청구서 상태 확인·다시 시도
        </Link>
      </div>
    </main>
  );
}
