-- 단기·행사 무료 베타: 현장별 관리 대상 3명 → 10명, 한 달 뒤 기능 잠금 (2026-11-05 사용자 결정)
-- 3명이면 8명 팝업이 4번째 초대에서 막힌다. 기간은 앱(admin-web lib/billing-gates.ts getGigBetaStatus)이
-- features.beta_days 와 구독 시작일로 계산하고, 이 규칙 이전에 시작한 현장은 beta_lock_from 부터 센다.
-- 잠긴 뒤에도 데이터는 지우지 않는다. 유료 전환은 그 현장의 plan_code 를 바꾸면 이 규칙에서 빠진다.

UPDATE public.service_plans
SET included_attendance_slots = 10,
    included_active_workers = 10,
    features = COALESCE(features, '{}'::jsonb) || '{"beta_days":30,"beta_lock_from":"2026-11-05"}'::jsonb
WHERE code = 'gigworker_trial';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.service_plans
    WHERE code = 'gigworker_trial' AND included_attendance_slots = 10 AND (features->>'beta_days')::int = 30
  ) THEN
    RAISE EXCEPTION 'gigworker_trial 베타 한도·기간이 적용되지 않았어요';
  END IF;
END $$;
