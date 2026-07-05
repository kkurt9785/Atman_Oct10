import Link from 'next/link';

export default function TossPaymentFailPage({
  searchParams,
}: {
  searchParams: { message?: string; code?: string };
}) {
  return (
    <main className="px-4 min-h-[70vh] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-card p-6 w-full text-center">
        <p className="text-5xl mb-4">⚠️</p>
        <h1 className="text-[22px] font-extrabold text-ink">결제가 완료되지 않았어요</h1>
        <p className="text-[14px] text-sub mt-2">
          {searchParams.message ?? '결제를 다시 시도하거나 다른 결제수단을 선택해 주세요.'}
        </p>
        {searchParams.code && (
          <p className="text-[11px] text-tertiary mt-2 font-mono">{searchParams.code}</p>
        )}
        <Link
          href="/membership"
          className="mt-6 h-12 rounded-xl bg-primary text-white text-[15px] font-bold flex items-center justify-center"
        >
          다시 충전하기
        </Link>
      </div>
    </main>
  );
}
