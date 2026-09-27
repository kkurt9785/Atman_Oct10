// 사업소득 원천징수 3.3% 간이 계산: 소득세 3% + 지방소득세(소득세의 10%). 각각 10원 미만 절사.
// 세무 신고·신고 기준일 등은 세무사 확인이 필요하다. 이 앱은 '얼마를 떼고 얼마를 보내는지'를 빠르게 보여 주는 용도다.
export const WITHHOLDING_RATE = 0.033;

export function withholding(amount: number, apply = true) {
  if (!apply || amount <= 0) return { incomeTax: 0, localTax: 0, total: 0, net: Math.max(0, amount), rate: 0 };
  const incomeTax = Math.floor((amount * 0.03) / 10) * 10;
  const localTax = Math.floor((incomeTax * 0.1) / 10) * 10;
  const total = incomeTax + localTax;
  return { incomeTax, localTax, total, net: amount - total, rate: WITHHOLDING_RATE };
}
