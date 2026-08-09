-- 약국 중심 초기 GTM 요금 통일.
-- 병원 기능은 유지하되 첫 유료 상품은 약국의 대체근무+근태 루프에 맞춘다.

UPDATE public.service_plans
SET monthly_fee = 69000,
    included_active_workers = 10,
    included_attendance_slots = 10,
    included_job_posting_slots = 3,
    features = features || jsonb_build_object(
      'popular', true,
      'repeat_invite', true,
      'tagline', '대체약사 모집부터 출퇴근·재요청까지'
    )
WHERE code = 'pharmacy';

UPDATE public.service_plans
SET monthly_fee = 119000,
    included_admin_seats = 3,
    included_active_workers = 30,
    included_attendance_slots = 20,
    included_job_posting_slots = 15,
    features = features || jsonb_build_object(
      'popular', false,
      'repeat_invite', true,
      'operations', true,
      'credential_status', true,
      'tagline', '여러 근무자와 반복 일정을 운영하는 약국'
    )
WHERE code = 'pharmacy_plus';

UPDATE public.service_plans
SET monthly_fee = 69000,
    included_active_workers = 5,
    features = features || jsonb_build_object(
      'repeat_invite', true,
      'tagline', '소형 병원의 모집·근태·휴가를 한 곳에서'
    )
WHERE code = 'clinic';

-- 영구 무료 체류보다 전체 흐름 체험이 목적이다. 신규 사업장은 30일 유료기능 체험 후 전환된다.
UPDATE public.service_plans
SET included_job_posting_slots = 1,
    included_active_workers = 0,
    features = features || jsonb_build_object('repeat_invite', false)
WHERE code = 'free';
