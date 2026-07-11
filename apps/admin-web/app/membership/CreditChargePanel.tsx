'use client';

import { useState } from 'react';
import { CREDIT_TIERS, won } from '@/lib/billing';

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => {
      requestPayment: (
        method: '카드' | '가상계좌' | '계좌이체',
        options: {
          amount: number;
          orderId: string;
          orderName: string;
          customerName?: string;
          successUrl: string;
          failUrl: string;
        }
      ) => Promise<void>;
    };
  }
}

type ServerOrder = {
  orderId: string;
  orderName: string;
  amount: number;
  credit: number;
};

function TierCard({
  tier,
  selected,
  onClick,
}: {
  tier: typeof CREDIT_TIERS[number];
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-2xl border-2 p-4 transition-all relative ${
        selected ? 'border-primary bg-primary/5' : 'border-line bg-white'
      }`}
    >
      {tier.tag && (
        <span className={`absolute top-3 right-3 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
          tier.tag === '최대 혜택' ? 'bg-amber-100 text-amber-600' :
          tier.tag === '추천' ? 'bg-primary/10 text-primary' :
          'bg-green-50 text-green-600'
        }`}>
          {tier.tag}
        </span>
      )}
      <div className="flex items-end gap-2 mb-1.5 pl-6">
        <span className="text-[18px] font-extrabold text-ink">{won(tier.charge)}</span>
        <span className="text-[13px] text-sub mb-0.5">결제 시</span>
      </div>
      <div className="flex items-center gap-2 pl-6">
        <span className="text-[15px] font-bold text-primary">{won(tier.credit)} 크레딧</span>
        {tier.bonus > 0 && (
          <span className="text-[12px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            보너스 {won(tier.bonus)}
          </span>
        )}
      </div>
      <div className={`absolute top-4 left-4 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? 'border-primary bg-primary' : 'border-line'
      }`}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>
    </button>
  );
}

export default function CreditChargePanel({
  initialAmount,
  currentBalance,
  recommendedAmount,
}: {
  initialAmount: number;
  currentBalance: number;
  recommendedAmount: number;
}) {
  const initialTier = CREDIT_TIERS.find((tier) => tier.charge === initialAmount)
    ?? CREDIT_TIERS.find((tier) => tier.charge === recommendedAmount)
    ?? CREDIT_TIERS[1];
  const [selectedId, setSelectedId] = useState<number | null>(initialTier.id);
  const [showConfirm, setShowConfirm] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentError, setPaymentError] = useState('');

  const selected = CREDIT_TIERS.find((t) => t.id === selectedId);
  const tossClientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  const canPay = Boolean(tossClientKey);

  function loadTossScript() {
    return new Promise<void>((resolve, reject) => {
      if (window.TossPayments) {
        resolve();
        return;
      }

      const existing = document.querySelector<HTMLScriptElement>('script[data-toss-payments]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('토스페이먼츠 스크립트를 불러오지 못했어요.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://js.tosspayments.com/v1/payment';
      script.async = true;
      script.dataset.tossPayments = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('토스페이먼츠 스크립트를 불러오지 못했어요.'));
      document.head.appendChild(script);
    });
  }

  async function createServerOrder(tierId: number): Promise<ServerOrder> {
    const response = await fetch('/api/payments/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tierId }),
    });
    const body = await response.json().catch(() => ({})) as Partial<ServerOrder> & { error?: string };
    if (!response.ok || !body.orderId || !body.orderName || typeof body.amount !== 'number') {
      throw new Error(body.error ?? '서버 주문을 만들지 못했어요.');
    }
    return body as ServerOrder;
  }

  async function handlePayment() {
    if (!selected || !tossClientKey || paying) return;
    setPaymentError('');
    setPaying(true);

    try {
      const order = await createServerOrder(selected.id);
      await loadTossScript();
      const tossPayments = window.TossPayments?.(tossClientKey);
      if (!tossPayments) throw new Error('토스페이먼츠를 시작할 수 없어요.');

      const origin = window.location.origin;
      await tossPayments.requestPayment('카드', {
        amount: order.amount,
        orderId: order.orderId,
        orderName: order.orderName,
        customerName: '잇닿 병원 관리자',
        successUrl: `${origin}/membership/success`,
        failUrl: `${origin}/membership/fail?localOrderId=${encodeURIComponent(order.orderId)}`,
      });
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : '결제창을 열지 못했어요.');
      setPaying(false);
    }
  }

  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 flex items-start gap-2">
        <span className="text-[16px] mt-0.5">💳</span>
        <div>
          <p className="text-[13px] font-bold text-amber-700">결제 주문은 서버에서 먼저 생성돼요</p>
          <p className="text-[11px] text-amber-600 mt-0.5">승인 금액과 지급 크레딧을 서버 원장 기준으로 검증합니다.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 mb-6">
        {CREDIT_TIERS.map((tier) => (
          <TierCard
            key={tier.id}
            tier={tier}
            selected={selectedId === tier.id}
            onClick={() => setSelectedId(tier.id)}
          />
        ))}
      </div>

      {selected && (
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="w-full h-14 bg-primary text-white rounded-2xl text-[16px] font-extrabold shadow-btn active:opacity-80 mb-8"
        >
          {won(selected.charge)} 결제하기 →&nbsp;
          <span className="opacity-80 text-[14px]">{won(selected.credit)} 크레딧</span>
        </button>
      )}

      <div className="bg-bg rounded-2xl p-4 mb-6">
        <p className="text-[13px] font-bold text-ink mb-2">크레딧 사용 안내</p>
        <ul className="text-[12px] text-sub space-y-1.5">
          <li>✓ 체크아웃 시 임금과 플랫폼 수수료가 한 트랜잭션으로 차감돼요.</li>
          <li>✓ 원금·보너스 크레딧은 원장에 구분 기록돼요.</li>
          <li>✓ 환불·취소는 결제 원장과 사용 내역 확인 후 처리해야 해요.</li>
        </ul>
      </div>

      {showConfirm && selected && (
        <>
          <button type="button" aria-label="닫기" className="fixed inset-0 bg-black/40 z-40" onClick={() => !paying && setShowConfirm(false)} />
          <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white rounded-t-3xl z-50 px-5 pt-6 pb-10">
            <div className="w-10 h-1 bg-line rounded-full mx-auto mb-5" />
            <p className="text-[18px] font-extrabold text-ink mb-4">결제 확인</p>
            <div className="bg-bg rounded-2xl p-4 mb-5 space-y-2">
              <div className="flex justify-between text-[13px]"><span className="text-sub">현재 크레딧</span><span className="font-bold text-ink">{won(currentBalance)}</span></div>
              <div className="flex justify-between text-[13px]"><span className="text-sub">결제 금액</span><span className="font-bold text-ink">{won(selected.charge)}</span></div>
              <div className="flex justify-between text-[13px]"><span className="text-sub">기본 크레딧</span><span className="font-bold text-ink">{won(selected.credit - selected.bonus)}</span></div>
              {selected.bonus > 0 && (
                <div className="flex justify-between text-[13px]"><span className="text-sub">보너스 크레딧</span><span className="font-bold text-primary">+{won(selected.bonus)}</span></div>
              )}
              <div className="flex justify-between text-[14px] pt-2 border-t border-line"><span className="font-bold text-ink">총 지급 크레딧</span><span className="font-extrabold text-primary">{won(selected.credit)}</span></div>
            </div>
            {canPay ? (
              <button
                type="button"
                onClick={handlePayment}
                disabled={paying}
                className="w-full h-14 bg-primary text-white text-[16px] font-extrabold rounded-2xl disabled:opacity-50"
              >
                {paying ? '주문 생성·결제창 여는 중...' : '토스페이먼츠로 결제하기'}
              </button>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                <p className="text-[13px] font-bold text-amber-700">결제 환경변수 설정 필요</p>
                <p className="text-[11px] text-amber-600 mt-0.5">운영 전 테스트 키로 주문·승인·웹훅 복구를 검증하세요.</p>
              </div>
            )}
            {paymentError && <p role="alert" className="text-[12px] text-warn font-bold mt-3">{paymentError}</p>}
            <button type="button" disabled={paying} onClick={() => setShowConfirm(false)} className="w-full mt-2 py-3 text-[14px] text-sub font-semibold disabled:opacity-40">닫기</button>
          </div>
        </>
      )}
    </>
  );
}
