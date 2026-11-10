// 입사일로 따진 법정 연차(근로기준법 제60조) '참고값'. 자동으로 부여하지 않고 휴가 설정 화면에서 제안만 한다 —
// 5인 미만 사업장·주 15시간 미만 근무자는 적용 대상이 아니고, 회계연도 기준으로 주는 곳도 있어서다.
export type AnnualLeaveSuggestion = {
  days: number;
  // monthly: 1년 미만(한 달 개근마다 1일, 최대 11일) · yearly: 1년 이상(15일 + 2년마다 1일, 최대 25일)
  basis: 'monthly' | 'yearly';
  serviceYears: number;
  serviceMonths: number;
};

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function suggestAnnualLeave(hireDate: string | null | undefined, today: string): AnnualLeaveSuggestion | null {
  const hire = DATE.exec(hireDate ?? '');
  const now = DATE.exec(today);
  if (!hire || !now) return null;
  const [hy, hm, hd] = [Number(hire[1]), Number(hire[2]), Number(hire[3])];
  const [ty, tm, td] = [Number(now[1]), Number(now[2]), Number(now[3])];
  // 꽉 채운 개월 수 — 입사한 날짜가 아직 안 온 달은 세지 않는다
  const months = (ty - hy) * 12 + (tm - hm) - (td < hd ? 1 : 0);
  if (months < 0) return null;
  const serviceYears = Math.floor(months / 12);
  if (serviceYears < 1) return { days: Math.min(months, 11), basis: 'monthly', serviceYears, serviceMonths: months };
  return { days: Math.min(25, 15 + Math.floor((serviceYears - 1) / 2)), basis: 'yearly', serviceYears, serviceMonths: months };
}
