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
    message: '사용자가 결제창에서 결제를 완료하지 않았습니다.',
  });

  return (
    <main className="px-4 min-h-[70vh] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-card p-6 w-full text-center">
        <p className="text-5xl mb-4">⚠️</p>
        <h1 className="text-[22px] font-extrabold text-ink">결제가 완료되지 않았어요</h1>
        <p className="text-[14px] text-sub mt-2 leading-6">카드 승인 문자를 받았다면 중복 결제하지 말고 청구서 상태를 먼저 확인해 주세요. 승인 내역이 없다면 같은 청구서에서 다시 시도할 수 있습니다.</p>
        {params.code && <p className="text-[11px] text-tertiary mt-2 font-mono">오류 코드: {params.code.slice(0, 80)}</p>}
        <Link href="/membership" className="mt-6 h-12 rounded-xl bg-primary text-white text-[15px] font-bold flex items-center justify-center">
          청구서 상태 확인·다시 시도
        </Link>
      </div>
    </main>
  );
}
