export type CreditTier = {
  id: number;
  charge: number;
  credit: number;
  bonus: number;
  bonusRate: number;
  label: string;
  tag: string | null;
};

// Toss 수수료 3.4% 반영: credit < charge × 0.966 → 수수료 커버 + 플랫폼 마진
// 이익 = (charge × 0.966) - credit / 50만원 +1.8만, 100만원 +2.6만, 이상 ~2.6%
export const CREDIT_TIERS: CreditTier[] = [
  { id: 1, charge: 500_000,    credit: 465_000,   bonus: 0,        bonusRate: 0,   label: '50만원',     tag: null },
  { id: 2, charge: 1_000_000,  credit: 940_000,   bonus: 0,        bonusRate: 0,   label: '100만원',   tag: null },
  { id: 3, charge: 3_000_000,  credit: 2_820_000, bonus: 20_000,   bonusRate: 0.7, label: '300만원',   tag: '추천' },
  { id: 4, charge: 5_000_000,  credit: 4_700_000, bonus: 50_000,   bonusRate: 1,   label: '500만원',   tag: '인기' },
  { id: 5, charge: 10_000_000, credit: 9_460_000, bonus: 100_000,  bonusRate: 1,   label: '1,000만원+', tag: '최대 혜택' },
];

export function won(n: number) {
  return `₩${Math.abs(Math.round(n)).toLocaleString('ko-KR')}`;
}

export function findCreditTierByCharge(amount: number) {
  return CREDIT_TIERS.find((tier) => tier.charge === amount) ?? null;
}

export function recommendedTierForShortfall(shortfall: number) {
  if (shortfall <= 0) return CREDIT_TIERS[1];
  return CREDIT_TIERS.find((tier) => tier.credit >= shortfall) ?? CREDIT_TIERS[CREDIT_TIERS.length - 1];
}

export const PLATFORM_FEE_RATE = 0.12;

export function estimatedFacilityCharge(grossPay: number, feeRate = PLATFORM_FEE_RATE) {
  return Math.max(0, Math.round(grossPay * (1 + feeRate)));
}
