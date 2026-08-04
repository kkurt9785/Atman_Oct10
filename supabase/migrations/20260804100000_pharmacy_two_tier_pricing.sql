-- ============================================================================
-- 약국 전용 2단 요금제 (2026-08-04 시연 피드백)
--   약국 화면에 병원용 basic/pro/enterprise까지 5장이 나가던 것을
--   Free + Pharmacy 59,000(★인기) + Pharmacy Plus 99,000 으로 재편.
--   ① pharmacy 69,000 → 59,000 인하 + ★인기 (소형 약국 주력)
--   ② pharmacy_plus 99,000 신설 (대체약사 풀 확장 + 반복 일정 자동화)
--   ③ 신규 약국의 30일 체험 = pro 대신 pharmacy_plus (병원은 pro 유지)
-- ============================================================================

-- ① Pharmacy 59,000 (★인기)
UPDATE public.service_plans
SET monthly_fee = 59000,
    sort_order = 12,
    features = features || jsonb_build_object(
      'popular', true,
      'tagline', '약국 운영의 기본 — 근태·휴가·대체약사 반복요청'
    )
WHERE code = 'pharmacy';

-- ② Pharmacy Plus 99,000 신설
INSERT INTO public.service_plans (
  code, name, monthly_fee, included_facilities, included_admin_seats,
  included_active_workers, included_attendance_slots, included_job_posting_slots,
  features, is_active, sort_order
) VALUES (
  'pharmacy_plus', 'Pharmacy Plus', 99000, 1, 2, 30, 20, 15,
  jsonb_build_object(
    'popular', false,
    'support', 'standard',
    'tagline', '대체약사 풀과 반복 일정 자동화로 확장 운영',
    'attendance', true,
    'leave_lite', true,
    'payroll_review', true,
    'repeat_invite', true,
    'operations', true,
    'credential_status', true
  ), true, 16
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, monthly_fee = EXCLUDED.monthly_fee,
  included_admin_seats = EXCLUDED.included_admin_seats,
  included_active_workers = EXCLUDED.included_active_workers,
  included_attendance_slots = EXCLUDED.included_attendance_slots,
  included_job_posting_slots = EXCLUDED.included_job_posting_slots,
  features = EXCLUDED.features, is_active = true, sort_order = EXCLUDED.sort_order;

-- ③ 신규 사업장 체험: 약국이면 pharmacy_plus, 그 외 pro (기존 트리거 함수 교체)
CREATE OR REPLACE FUNCTION public.start_facility_pro_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_today date := (timezone('Asia/Seoul', now()))::date;
BEGIN
  INSERT INTO public.facility_subscriptions (
    facility_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, trial_started_at, trial_ends_at
  )
  SELECT NEW.id,
    CASE WHEN NEW.facility_type = 'pharmacy' THEN 'pharmacy_plus' ELSE 'pro' END,
    'active', 'monthly', v_today, v_today + 29, now(), v_today + 29
  WHERE NOT EXISTS (
    SELECT 1 FROM public.facility_subscriptions
    WHERE facility_id = NEW.id AND status IN ('pending', 'active', 'past_due')
  );
  RETURN NEW;
END;
$$;

-- 기존 약국의 진행 중 Pro 체험도 pharmacy_plus 체험으로 정렬 (표시 일관성)
UPDATE public.facility_subscriptions fs
SET plan_code = 'pharmacy_plus', updated_at = now()
FROM public.facilities f
WHERE f.id = fs.facility_id
  AND f.facility_type = 'pharmacy'
  AND fs.plan_code = 'pro'
  AND fs.trial_started_at IS NOT NULL
  AND fs.trial_converted_at IS NULL;

-- 검증 (2행: pharmacy 59000 / pharmacy_plus 99000·operations true)
SELECT code, monthly_fee, sort_order,
       features->>'popular' AS popular, features->>'operations' AS operations
FROM public.service_plans
WHERE code IN ('pharmacy', 'pharmacy_plus') AND is_active = true
ORDER BY sort_order;
