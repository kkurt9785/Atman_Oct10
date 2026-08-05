-- ============================================================================
-- 결제 주기·장기결제 할인 (2026-08-05)
--   월간 / 6개월 선결제(5%) / 1년 선결제(10%) — 기존 연납 17% 정책 대체
--   ① billing_cycle에 semiannual 추가
--   ② 유료 플랜에 cycle_discounts 메타 (화면·청구 계산의 단일 소스)
--   실결제(카드 자동결제)는 토스 계약 후 — 현재는 표시·청구서 계산용
-- ============================================================================

ALTER TABLE public.facility_subscriptions
  DROP CONSTRAINT IF EXISTS facility_subscriptions_billing_cycle_check;
ALTER TABLE public.facility_subscriptions
  ADD CONSTRAINT facility_subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly','semiannual','annual'));

-- 유료 정액 플랜에 할인 메타 (free=0원, enterprise=문의 제외)
UPDATE public.service_plans
SET features = features || jsonb_build_object(
  'cycle_discounts', jsonb_build_object('semiannual', 0.05, 'annual', 0.10)
)
WHERE is_active = true AND monthly_fee > 0 AND code <> 'enterprise';

-- 검증: 할인 메타 적용 플랜 목록 (clinic·pharmacy·pharmacy_plus·basic·pro = 5행)
SELECT code, monthly_fee,
       features->'cycle_discounts'->>'semiannual' AS semiannual,
       features->'cycle_discounts'->>'annual' AS annual
FROM public.service_plans
WHERE is_active = true AND features ? 'cycle_discounts'
ORDER BY sort_order;
