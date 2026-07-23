-- Align the clinic package with the expanded recruitment + workforce SaaS.
UPDATE public.service_plans
SET monthly_fee = 59000,
    features = COALESCE(features,'{}'::jsonb) || jsonb_build_object(
      'attendance',true,'leave_lite',true,'payroll_review',true,
      'tagline','직원 10명 채용·근태·휴가·급여 검토를 한 곳에서'
    )
WHERE code = 'clinic';

ALTER TABLE public.facility_staff
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS account_last4 text
    CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9]{4}$');

COMMENT ON COLUMN public.facility_staff.account_last4 IS '병원 직접지급 확인용 계좌 끝 4자리. 전체 계좌번호는 저장하지 않는다.';
