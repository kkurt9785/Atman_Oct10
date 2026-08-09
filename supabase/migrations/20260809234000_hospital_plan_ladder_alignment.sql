-- 소형 병원(10명)에서 요양병원(30~100명)으로 자연스럽게 확장되는 병원 플랜 계단.

UPDATE public.service_plans
SET monthly_fee = 119000,
    included_admin_seats = 3,
    included_active_workers = 30,
    included_attendance_slots = 30,
    included_job_posting_slots = 15,
    features = features || jsonb_build_object(
      'tagline', '직원 30명 안팎 병원·요양병원의 반복 인력 운영',
      'repeat_invite', true
    )
WHERE code = 'basic';

UPDATE public.service_plans
SET monthly_fee = 199000,
    included_admin_seats = 5,
    included_active_workers = 100,
    included_attendance_slots = 100,
    included_job_posting_slots = 999999,
    features = features || jsonb_build_object(
      'tagline', '교대근무와 반복 결원을 관리하는 요양병원',
      'popular', true,
      'repeat_invite', true,
      'operations', true,
      'credential_status', true
    )
WHERE code = 'pro';
