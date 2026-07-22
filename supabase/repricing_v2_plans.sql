-- ============================================================================
-- 요금제 v3 개편 — 4단계 가치 구조 (docs/pricing_policy.md)
--   축 전환: 지점 수 → 병원 규모(공고·인력풀 반복초대). 단일병원 90% 대응.
--   included_active_workers = 인력풀 반복초대 대상 수(재정의). 무제한 = 999999.
--   ⚠️ 가격은 데모용 v1 — 파일럿 후 조정.
-- ============================================================================

-- 구 3단(starter/growth/network) 비활성화 (구독 이력 보존 위해 삭제 안 함)
UPDATE public.service_plans SET is_active = false
WHERE code IN ('starter', 'growth', 'network');

-- 신 4단 upsert
INSERT INTO public.service_plans
  (code, name, monthly_fee, included_facilities, included_admin_seats,
   included_active_workers, included_attendance_slots, included_job_posting_slots,
   features, is_active, sort_order)
VALUES
  ('free',   'Free 파일럿', 0,      1, 1, 0,      999999, 3,
   '{"support":"standard","credential_status":true,"popular":false,"tagline":"월 3건으로 직접 확인하는 병원 인력 운영"}', true, 10),
  ('basic',  'Basic',      79000,  1, 2, 20,     999999, 15,
   '{"support":"standard","credential_status":true,"repeat_invite":true,"popular":false,"tagline":"소형 병원의 반복 인력 운영"}', true, 20),
  ('pro',    'Pro',        149000, 1, 5, 60,     999999, 999999,
   '{"support":"priority","credential_status":true,"license_verification":true,"license_monitoring":true,"repeat_invite":true,"analytics":true,"operations":true,"popular":true,"tagline":"인력 공백과 반복근무를 자동화하는 주력 플랜"}', true, 30),
  ('enterprise','Enterprise',399000, 3, 15, 999999, 999999, 999999,
   '{"support":"dedicated","credential_status":true,"license_verification":true,"license_monitoring":true,"repeat_invite":true,"analytics":true,"operations":true,"api":true,"audit_log":true,"custom_pricing":true,"popular":false,"tagline":"대형·종합병원 및 다병원 통합 운영"}', true, 40)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, monthly_fee = EXCLUDED.monthly_fee,
  included_facilities = EXCLUDED.included_facilities,
  included_admin_seats = EXCLUDED.included_admin_seats,
  included_active_workers = EXCLUDED.included_active_workers,
  included_attendance_slots = EXCLUDED.included_attendance_slots,
  included_job_posting_slots = EXCLUDED.included_job_posting_slots,
  features = EXCLUDED.features, is_active = true, sort_order = EXCLUDED.sort_order;

-- 검증
SELECT sort_order, code, name, monthly_fee,
       included_job_posting_slots AS 공고,
       included_active_workers AS 반복초대,
       features->>'popular' AS 인기
FROM public.service_plans
WHERE is_active = true
ORDER BY sort_order;
