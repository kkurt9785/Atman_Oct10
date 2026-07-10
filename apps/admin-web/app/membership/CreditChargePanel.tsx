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
      onClick={onClick}
      className={`w-full text-left rounded-2xl border-2 p-4 transition-all relative ${
        selected ? 'border-primary bg-primary/5' : 'border-line bg-white'
      }`}
    >
      {tier.tag && (
        <span className={`absolute top-3 right-3 text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
          tier.tag === '최대 혜택' ? 'bg-amber-100 text-amber-600' :
          tier.tag === '추천'     ? 'bg-primary/10 text-primary' :
                                    'bg-green-50 text-green-600'
        }`}>
          {tier.tag}
        </span>
      )}
      <div className="flex items-end gap-2 mb-1.5 pl-6">
        <span className="text-[18px] font-extrabold text-ink">{won(tier.charge)}</span>
        <span className="text-[13px] text-sub mb-0.5">충전 시</span>
      </div>
      <div className="flex items-center gap-2 pl-6">
        <span className="text-[15px] font-bold text-primary">{won(tier.credit)} 크레딧</span>
        {tier.bonus > 0 && (
          <span className="text-[12px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            +{tier.bonusRate}% 보너스
          </span>
        )}
      </div>
      {tier.bonus > 0 && (
        <p className="text-[11px] text-sub mt-1 pl-6">보너스 {won(tier.bonus)} 추가 지급</p>
      )}
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
  const canPay = !!tossClientKey;

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

  async function handlePayment() {
    if (!selected || !tossClientKey) return;
    setPaymentError('');
    setPaying(true);

    try {
      await loadTossScript();
      const tossPayments = window.TossPayments?.(tossClientKey);
      if (!tossPayments) throw new Error('토스페이먼츠를 시작할 수 없어요.');

      const origin = window.location.origin;
      const orderId = `atman_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await tossPayments.requestPayment('카드', {
        amount: selected.charge,
        orderId,
        orderName: `잇닿 크레딧 ${selected.label}`,
        customerName: '잇닿 병원 관리자',
        successUrl: `${origin}/membership/success`,
        failUrl: `${origin}/membership/fail`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : '결제창을 열지 못했어요.';
      setPaymentError(message);
      setPaying(false);
    }
  }

  return (
    <>
      {/* 대량 충전 혜택 안내 */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 flex items-start gap-2">
        <span className="text-[16px] mt-0.5">🎁</span>
        <div>
          <p className="text-[13px] font-bold text-amber-700">300만원 이상 충전 시 보너스 크레딧 제공</p>
          <p className="text-[11px] text-amber-600 mt-0.5">보너스 크레딧은 임금 지급에 동일하게 사용돼요</p>
        </div>
      </div>

      {/* 티어 선택 */}
      <div className="flex flex-col gap-3 mb-6">
        {CREDIT_TIERS.map((t) => (
          <TierCard key={t.id} tier={t} selected={selectedId === t.id} onClick={() => setSelectedId(t.id)} />
        ))}
      </div>

      {/* 충전 버튼 */}
      {selected && (
        <button
          onClick={() => setShowConfirm(true)}
          className="w-full h-14 bg-primary text-white rounded-2xl text-[16px] font-extrabold shadow-btn active:opacity-80 mb-8"
        >
          {won(selected.charge)} 충전하기 →&nbsp;
          <span className="opacity-80 text-[14px]">{won(selected.credit)} 크레딧</span>
        </button>
      )}

      {/* 크레딧 사용 안내 */}
      <div className="bg-bg rounded-2xl p-4 mb-6">
        <p className="text-[13px] font-bold text-ink mb-2">크레딧 사용 방법</p>
        <ul className="text-[12px] text-sub space-y-1.5">
          <li>✓ 시프트 체크아웃 완료 시 임금 자동 차감</li>
          <li>✓ 잔액은 다음 시프트에 이월 (유효기간 1년)</li>
          <li>✓ 원금은 충전 후 1년 내 환불 가능</li>
          <li>✓ 보너스 크레딧은 환불 불가 (포인트 성격)</li>
        </ul>
      </div>

      {/* 충전 확인 모달 */}
      {showConfirm && selected && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowConfirm(false)} />
          <div className="fixed bottom-0 inset-x-0 mx-auto max-w-app bg-white rounded-t-3xl z-50 px-5 pt-6 pb-10">
            <div className="w-10 h-1 bg-line rounded-full mx-auto mb-5" />
            <p className="text-[18px] font-extrabold text-ink mb-4">충전 확인</p>
            <div className="bg-bg rounded-2xl p-4 mb-5 space-y-2">
              <div className="flex justify-between text-[13px]">
                <span className="text-sub">현재 크레딧</span>
                <span className="font-bold text-ink">{won(currentBalance)}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-sub">결제 금액</span>
                <span className="font-bold text-ink">{won(selected.charge)}</span>
              </div>
              {selected.bonus > 0 && (
                <div className="flex justify-between text-[13px]">
                  <span className="text-sub">보너스 크레딧 (+{selected.bonusRate}%)</span>
                  <span className="font-bold text-primary">+{won(selected.bonus)}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] pt-2 border-t border-line">
                <span className="font-bold text-ink">지급 크레딧</span>
                <span className="font-extrabold text-primary">{won(selected.credit)}</span>
              </div>
            </div>
            {canPay ? (
              <button
                onClick={handlePayment}
                disabled={paying}
                className="w-full h-14 bg-primary text-white text-[16px] font-extrabold rounded-2xl disabled:opacity-50"
              >
                {paying ? '결제창 여는 중...' : '토스페이먼츠로 결제하기'}
              </button>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
                <p className="text-[13px] font-bold text-amber-700">🚧 결제 키 설정 필요</p>
                <p className="text-[11px] text-amber-600 mt-0.5">
                  Vercel에 NEXT_PUBLIC_TOSS_CLIENT_KEY, TOSS_SECRET_KEY를 설정하면 결제가 활성화돼요
                </p>
              </div>
            )}
            {paymentError && (
              <p className="text-[12px] text-warn font-bold mt-3">{paymentError}</p>
            )}
            <button
              onClick={() => setShowConfirm(false)}
              className="w-full mt-2 py-3 text-[14px] text-sub font-semibold"
            >
              닫기
            </button>
          </div>
        </>
      )}
    </>
  );
}
