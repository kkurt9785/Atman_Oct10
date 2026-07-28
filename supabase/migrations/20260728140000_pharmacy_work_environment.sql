ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS pharmacy_type text,
  ADD COLUMN IF NOT EXISTS pharmacy_system text,
  ADD COLUMN IF NOT EXISTS average_daily_prescriptions integer
    CHECK (average_daily_prescriptions IS NULL OR average_daily_prescriptions BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS handover_minutes integer
    CHECK (handover_minutes IS NULL OR handover_minutes BETWEEN 0 AND 240);

COMMENT ON COLUMN public.facilities.average_daily_prescriptions IS
  '약국 근무 강도 판단용 일평균 처방전 수. 공개 화면에는 범위로 표시할 수 있다.';

UPDATE public.facilities
SET pharmacy_type='문전약국', pharmacy_system='유팜',
    average_daily_prescriptions=140, handover_minutes=20,
    intro='처음 근무하는 약사에게 20분 인수인계를 제공하며, 잘 맞으면 토요일 반복근무를 우선 요청합니다.'
WHERE business_registration_number='DEMO-TARGET-PHARMACY';
