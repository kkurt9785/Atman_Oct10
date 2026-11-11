// 가입 전에 보여 주는 업종별 시작 요금 — 로그인 화면과 신규 사업장 등록 요청이 같은 숫자를 쓴다.
// 실제 청구 금액의 정본은 DB service_plans 다(설정 → 요금제). 요금이 바뀌면 여기도 같이 고친다.
export const TRIAL_DAYS = 30;
export const PLAN_INTRO = [
  { key: 'pharmacy', label: '약국', price: '5명 59,000원부터' },
  { key: 'medical', label: '병원·의원', price: '10명 69,000원' },
  { key: 'care', label: '요양병원', price: '20명 119,000원' },
] as const;

// 단기·행사 근태 조건(2026-11-05 결정: 한 달 · 근무자 10명, lib/billing-gates.ts). 로그인 화면이 병원·약국 요금만 보여 단기 사장님이 '병원용'으로 읽었다(2026-11-11 단기 근로 QA)
export const GIG_BETA_INTRO = '단기·행사(팝업·매장 보조) 근태는 한 달 무료 베타 · 근무자 10명까지예요.';
