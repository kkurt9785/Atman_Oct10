-- Login-capable worker accounts and completed-work evidence for the two sales demos.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

WITH demo_workers(email, display_name, kakao_id) AS (
  VALUES
    ('worker-demo-pharmacist@demo.atman.co.kr', '수원 데모 약사', 'demo_pharmacist_1'),
    ('worker-demo-pharmacy-staff@demo.atman.co.kr', '수원 데모 약국 전산직', 'demo_pharmacy_staff_1')
),
upsert_users AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  SELECT
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
    'authenticated', 'authenticated', email,
    extensions.crypt('Atman-demo-2026!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('profile_nickname', display_name), now(), now()
  FROM demo_workers
  ON CONFLICT (email) WHERE is_sso_user = false DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
    updated_at = now()
  RETURNING id, email
),
profile_rows AS (
  INSERT INTO public.profiles (id, role, onboarding_done)
  SELECT id, 'worker', true FROM upsert_users
  ON CONFLICT (id) DO UPDATE SET role = 'worker', onboarding_done = true, updated_at = now()
)
UPDATE public.workers w
SET auth_user_id = u.id, email = u.email, verification_status = 'approved',
    verified_at = COALESCE(w.verified_at, now()), is_demo = true,
    deleted_at = NULL, updated_at = now()
FROM upsert_users u
JOIN demo_workers d ON d.email = u.email
WHERE w.kakao_id = d.kakao_id;

INSERT INTO public.worker_location_prefs (worker_id, locations)
SELECT u.id, '[{"label":"수원 권선구","radius_km":12}]'::jsonb
FROM auth.users u
WHERE u.email IN (
  'worker-demo-pharmacist@demo.atman.co.kr',
  'worker-demo-pharmacy-staff@demo.atman.co.kr'
)
ON CONFLICT (worker_id) DO UPDATE SET locations = EXCLUDED.locations, updated_at = now();

DO $$
DECLARE
  v_hospital uuid;
  v_pharmacy uuid;
  v_nurse uuid;
  v_pharmacist uuid;
  v_shift uuid;
  v_application uuid;
  v_attendance uuid;
BEGIN
  SELECT id INTO v_hospital FROM public.facilities
  WHERE name = 'W여성병원' AND is_demo = true AND is_active = true AND deleted_at IS NULL
  ORDER BY business_registration_number LIMIT 1;
  SELECT id INTO v_pharmacy FROM public.facilities
  WHERE business_registration_number = 'DEMO-TARGET-PHARMACY'
    AND is_demo = true AND is_active = true AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_nurse FROM public.workers
  WHERE kakao_id = 'kakao_demo_suwon_jangan_01' AND is_demo = true AND deleted_at IS NULL;
  SELECT id INTO v_pharmacist FROM public.workers
  WHERE kakao_id = 'demo_pharmacist_1' AND is_demo = true AND deleted_at IS NULL;

  IF v_hospital IS NOT NULL AND v_nurse IS NOT NULL THEN
    SELECT id INTO v_shift FROM public.shifts WHERE notes = 'DEMO-WORKER-SALES-HOSPITAL-COMPLETED' LIMIT 1;
    IF v_shift IS NULL THEN
      INSERT INTO public.shifts (
        facility_id, required_role, shift_date, start_time, end_time, hourly_wage,
        estimated_total_pay, description, department, notes, status, matched_worker_id, matched_at
      ) VALUES (
        v_hospital, 'rn', current_date - 7, '09:00', '17:00', 17500, 140000,
        '시연용 완료 근무 · 병원 지원부터 근태와 급여까지 연결됩니다.', '외래',
        'DEMO-WORKER-SALES-HOSPITAL-COMPLETED', 'completed', v_nurse, now() - interval '7 days'
      ) RETURNING id INTO v_shift;
    END IF;
    INSERT INTO public.shift_applications (shift_id, worker_id, status, match_score, distance_meters, applied_at, responded_at)
    VALUES (v_shift, v_nurse, 'accepted', 96, 720, now() - interval '9 days', now() - interval '8 days')
    ON CONFLICT (shift_id, worker_id) DO UPDATE SET status = 'accepted', responded_at = EXCLUDED.responded_at
    RETURNING id INTO v_application;
    INSERT INTO public.shift_attendances (
      shift_id, worker_id, application_id, check_in_at, check_out_at,
      check_in_distance_m, check_out_distance_m, check_in_method,
      check_out_method, check_out_hmac_verified
    ) VALUES (
      v_shift, v_nurse, v_application,
      (current_date - 7)::timestamp + time '08:57', (current_date - 7)::timestamp + time '17:03',
      18, 14, 'button', 'qr', true
    ) ON CONFLICT (application_id) DO UPDATE SET
      check_in_at = EXCLUDED.check_in_at, check_out_at = EXCLUDED.check_out_at,
      check_in_distance_m = EXCLUDED.check_in_distance_m, check_out_distance_m = EXCLUDED.check_out_distance_m
    RETURNING id INTO v_attendance;
    INSERT INTO public.wage_payment_instructions (
      facility_id, worker_id, shift_id, attendance_id, gross_amount,
      deduction_status, net_amount, due_date, status, created_at, updated_at
    ) VALUES (
      v_hospital, v_nurse, v_shift, v_attendance, 140000,
      'unconfirmed', 140000, current_date + 1, 'approved', now() - interval '6 days', now()
    ) ON CONFLICT (attendance_id) DO UPDATE SET
      gross_amount = EXCLUDED.gross_amount, net_amount = EXCLUDED.net_amount,
      due_date = EXCLUDED.due_date, status = 'approved', updated_at = now();
  END IF;

  IF v_pharmacy IS NOT NULL AND v_pharmacist IS NOT NULL THEN
    SELECT id INTO v_shift FROM public.shifts WHERE notes = 'DEMO-WORKER-SALES-PHARMACY-COMPLETED' LIMIT 1;
    IF v_shift IS NULL THEN
      INSERT INTO public.shifts (
        facility_id, required_role, shift_date, start_time, end_time, hourly_wage,
        estimated_total_pay, description, department, notes, status, matched_worker_id, matched_at
      ) VALUES (
        v_pharmacy, 'pharmacist', current_date - 6, '09:00', '13:00', 38000, 152000,
        '시연용 완료 근무 · 대체약사 근태와 급여 연결을 보여줍니다.', '대체약사',
        'DEMO-WORKER-SALES-PHARMACY-COMPLETED', 'completed', v_pharmacist, now() - interval '6 days'
      ) RETURNING id INTO v_shift;
    END IF;
    INSERT INTO public.shift_applications (shift_id, worker_id, status, match_score, distance_meters, applied_at, responded_at)
    VALUES (v_shift, v_pharmacist, 'accepted', 97, 430, now() - interval '8 days', now() - interval '7 days')
    ON CONFLICT (shift_id, worker_id) DO UPDATE SET status = 'accepted', responded_at = EXCLUDED.responded_at
    RETURNING id INTO v_application;
    INSERT INTO public.shift_attendances (
      shift_id, worker_id, application_id, check_in_at, check_out_at,
      check_in_distance_m, check_out_distance_m, check_in_method,
      check_out_method, check_out_hmac_verified
    ) VALUES (
      v_shift, v_pharmacist, v_application,
      (current_date - 6)::timestamp + time '08:56', (current_date - 6)::timestamp + time '13:02',
      12, 9, 'button', 'qr', true
    ) ON CONFLICT (application_id) DO UPDATE SET
      check_in_at = EXCLUDED.check_in_at, check_out_at = EXCLUDED.check_out_at,
      check_in_distance_m = EXCLUDED.check_in_distance_m, check_out_distance_m = EXCLUDED.check_out_distance_m
    RETURNING id INTO v_attendance;
    INSERT INTO public.wage_payment_instructions (
      facility_id, worker_id, shift_id, attendance_id, gross_amount,
      deduction_status, net_amount, due_date, status, created_at, updated_at
    ) VALUES (
      v_pharmacy, v_pharmacist, v_shift, v_attendance, 152000,
      'unconfirmed', 152000, current_date + 1, 'approved', now() - interval '5 days', now()
    ) ON CONFLICT (attendance_id) DO UPDATE SET
      gross_amount = EXCLUDED.gross_amount, net_amount = EXCLUDED.net_amount,
      due_date = EXCLUDED.due_date, status = 'approved', updated_at = now();
  END IF;
END $$;
