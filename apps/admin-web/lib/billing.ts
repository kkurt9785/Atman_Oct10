export type CreditTier = {
  id: number;
  charge: number;
  credit: number;
  bonus: number;
  bonusRate: number;
  label: string;
  tag: string | null;
};

export const CREDIT_TIERS: CreditTier[] = [
  { id: 1, charge: 500000, credit: 500000, bonus: 0, bonusRate: 0, label: '50만원', tag: null },
  { id: 2, charge: 1000000, credit: 1070000, bonus: 70000, bonusRate: 7, label: '100만원', tag: '1주 운영' },
  { id: 3, charge: 3000000, credit: 3300000, bonus: 300000, bonusRate: 10, label: '300만원', tag: '2주 운영' },
  { id: 4, charge: 5000000, credit: 5750000, bonus: 750000, bonusRate: 15, label: '500만원', tag: '추천' },
  { id: 5, charge: 10000000, credit: 12000000, bonus: 2000000, bonusRate: 20, label: '1,000만원+', tag: '1개월 운영' },
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
