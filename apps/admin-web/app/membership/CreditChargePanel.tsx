'use client';

import { useState } from 'react';

const TIERS = [
  { id: 1, charge: 500000,   credit: 500000,   bonus: 0,      bonusRate: 0,  label: '50만원',    tag: null },
  { id: 2, charge: 1000000,  credit: 1070000,  bonus: 70000,  bonusRate: 7,  label: '100만원',   tag: '인기' },
  { id: 3, charge: 3000000,  credit: 3300000,  bonus: 300000, bonusRate: 10, label: '300만원',   tag: null },
  { id: 4, charge: 5000000,  credit: 5750000,  bonus: 750000, bonusRate: 15, label: '500만원',   tag: '추천' },
  { id: 5, charge: 10000000, credit: 12000000, bonus: 2000000,bonusRate: 20, label: '1,000만원+',tag: '최대 혜택' },
];

function won(n: number) {
  return '₩' + Math.abs(n).toLocaleString('ko-KR');
}

function TierCard({
  tier,
  selected,
  onClick,
}: {
  tier: typeof TIERS[number];
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
        <p className="text-[11px] text-tertiary mt-1 pl-6">보너스 {won(tier.bonus)} 추가 지급</p>
      )}
      <div className={`absolute top-4 left-4 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? 'border-primary bg-primary' : 'border-line'
      }`}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>
    </button>
  );
}

export default function CreditChargePanel() {
  const [selectedId, setSelectedId] = useState<number | null>(2);
  const [showConfirm, setShowConfirm] = useState(false);

  const selected = TIERS.find((t) => t.id === selectedId);

  return (
    <>
      {/* 볼륨 보너스 안내 */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 flex items-start gap-2">
        <span className="text-[16px] mt-0.5">🎁</span>
        <div>
          <p className="text-[13px] font-bold text-amber-700">많이 충전할수록 보너스 크레딧 ↑</p>
          <p className="text-[11px] text-amber-600 mt-0.5">보너스 크레딧은 수수료 결제에 동일하게 사용돼요</p>
        </div>
      </div>

      {/* 티어 선택 */}
      <div className="flex flex-col gap-3 mb-6">
        {TIERS.map((t) => (
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
                <span className="text-sub">결제 금액</span>
                <span className="font-bold text-ink">{won(selected.charge)}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-sub">기본 크레딧</span>
                <span className="font-bold text-ink">{won(selected.charge)}</span>
              </div>
              {selected.bonus > 0 && (
                <div className="flex justify-between text-[13px]">
                  <span className="text-sub">보너스 크레딧 (+{selected.bonusRate}%)</span>
                  <span className="font-bold text-primary">+{won(selected.bonus)}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] pt-2 border-t border-line">
                <span className="font-bold text-ink">지급 크레딧 합계</span>
                <span className="font-extrabold text-primary">{won(selected.credit)}</span>
              </div>
            </div>
            {/* 사업자 등록 전 — 결제 비활성화 */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
              <p className="text-[13px] font-bold text-amber-700">🚧 결제 준비 중</p>
              <p className="text-[11px] text-amber-600 mt-0.5">사업자 등록 완료 후 토스페이먼츠 결제가 활성화돼요</p>
            </div>
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
