-- Daily refresh for demo showcase shifts and login-capable demo worker accounts.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

WITH demo_workers(email, display_name, kakao_id, area_label) AS (
  VALUES
    ('worker-demo-1@demo.atman.co.kr', '광주 RN 데모워커', 'kakao_demo_gwangju_gwangsan_01', '광주 광산구'),
    ('worker-demo-2@demo.atman.co.kr', '수원 장안 RN 데모워커', 'kakao_demo_suwon_jangan_01', '수원 장안구'),
    ('worker-demo-3@demo.atman.co.kr', '수원 권선 NA 데모워커', 'kakao_demo_suwon_gwonseon_03', '수원 권선구'),
    ('worker-demo-4@demo.atman.co.kr', '수원 팔달 RN 데모워커', 'kakao_demo_suwon_paldal_01', '수원 팔달구'),
    ('worker-demo-5@demo.atman.co.kr', '수원 영통 NA 데모워커', 'kakao_demo_suwon_yeongtong_03', '수원 영통구')
),
upsert_users AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  SELECT
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    email,
    crypt('Atman-demo-2026!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('profile_nickname', display_name),
    now(),
    now()
  FROM demo_workers
  ON CONFLICT (email) WHERE is_sso_user = false DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = now()
  RETURNING id, email
),
profile_rows AS (
  INSERT INTO profiles (id, role, onboarding_done)
  SELECT id, 'worker', true FROM upsert_users
  ON CONFLICT (id) DO UPDATE SET
    role = 'worker',
    onboarding_done = true,
    updated_at = now()
  RETURNING id
)
UPDATE workers w
SET
  auth_user_id = u.id,
  email = u.email,
  verification_status = 'approved',
  verified_at = COALESCE(w.verified_at, now()),
  is_demo = true,
  deleted_at = NULL,
  updated_at = now()
FROM upsert_users u
JOIN demo_workers d ON d.email = u.email
WHERE w.kakao_id = d.kakao_id;

INSERT INTO worker_location_prefs (worker_id, locations)
SELECT
  u.id,
  jsonb_build_array(jsonb_build_object('label', d.area_label, 'radius_km', 12))
FROM auth.users u
JOIN (
  VALUES
    ('worker-demo-1@demo.atman.co.kr', '광주 광산구'),
    ('worker-demo-2@demo.atman.co.kr', '수원 장안구'),
    ('worker-demo-3@demo.atman.co.kr', '수원 권선구'),
    ('worker-demo-4@demo.atman.co.kr', '수원 팔달구'),
    ('worker-demo-5@demo.atman.co.kr', '수원 영통구')
) AS d(email, area_label) ON d.email = u.email
ON CONFLICT (worker_id) DO UPDATE SET
  locations = EXCLUDED.locations,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.refresh_demo_showcase_day()
RETURNS TABLE(kind TEXT, count BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM shift_attendances
  WHERE shift_id IN (SELECT id FROM shifts WHERE notes LIKE 'DEMO-SHOWCASE-%');

  DELETE FROM shift_applications
  WHERE shift_id IN (SELECT id FROM shifts WHERE notes LIKE 'DEMO-SHOWCASE-%');

  DELETE FROM shifts
  WHERE notes LIKE 'DEMO-SHOWCASE-%';

  WITH ranked_facilities AS (
    SELECT
      f.*,
      row_number() OVER (ORDER BY f.business_registration_number) AS rn
    FROM facilities f
    WHERE f.is_demo = true
      AND f.business_registration_number LIKE 'DEMO-TARGET-%'
  ),
  ranked_workers AS (
    SELECT
      w.*,
      row_number() OVER (ORDER BY w.kakao_id) AS rn
    FROM workers w
    WHERE w.is_demo = true
      AND w.kakao_id LIKE 'kakao_demo_%'
  ),
  matched_seed AS (
    SELECT
      f.rn,
      f.id AS facility_id,
      w.id AS worker_id,
      CASE WHEN f.rn % 3 = 1 THEN '07:00'::time WHEN f.rn % 3 = 2 THEN '15:00'::time ELSE '23:00'::time END AS start_time,
      CASE WHEN f.rn % 3 = 1 THEN '15:00'::time WHEN f.rn % 3 = 2 THEN '23:00'::time ELSE '07:00'::time END AS end_time,
      CASE WHEN w.role = 'rn' THEN 'rn' ELSE 'na' END AS required_role,
      CASE WHEN w.role = 'rn' THEN 17000 ELSE 14000 END AS hourly_wage,
      CASE WHEN f.facility_type IN ('general_hospital', 'small_hospital') THEN '일반병동' ELSE '요양병동' END AS department
    FROM ranked_facilities f
    JOIN ranked_workers w ON w.rn = (f.rn * 2 - 1)
  ),
  open_seed AS (
    SELECT
      f.rn,
      f.id AS facility_id,
      w.id AS worker_id,
      CASE WHEN f.rn % 3 = 1 THEN '15:00'::time WHEN f.rn % 3 = 2 THEN '23:00'::time ELSE '07:00'::time END AS start_time,
      CASE WHEN f.rn % 3 = 1 THEN '23:00'::time WHEN f.rn % 3 = 2 THEN '07:00'::time ELSE '15:00'::time END AS end_time,
      CASE WHEN w.role = 'rn' THEN 'rn' ELSE 'na' END AS required_role,
      CASE WHEN w.role = 'rn' THEN 17500 ELSE 14500 END AS hourly_wage,
      CASE WHEN f.facility_type IN ('general_hospital', 'small_hospital') THEN '응급실' ELSE '요양병동' END AS department
    FROM ranked_facilities f
    JOIN ranked_workers w ON w.rn = (f.rn * 2)
  ),
  matched_shifts AS (
    INSERT INTO shifts (
      facility_id, required_role, shift_date, start_time, end_time, hourly_wage,
      estimated_total_pay, description, department, notes, status, matched_worker_id, matched_at
    )
    SELECT
      facility_id,
      required_role,
      timezone('Asia/Seoul', now())::date,
      start_time,
      end_time,
      hourly_wage,
      hourly_wage * 8,
      '시연용 오늘 확정 근무입니다. 데모 워커가 배정되어 관리자 홈에 표시됩니다.',
      department,
      'DEMO-SHOWCASE-MATCHED-' || lpad(rn::text, 4, '0'),
      'in_progress',
      worker_id,
      now() - interval '30 minutes'
    FROM matched_seed
    RETURNING id, matched_worker_id
  ),
  matched_apps AS (
    INSERT INTO shift_applications (shift_id, worker_id, status, match_score, distance_meters, applied_at, responded_at)
    SELECT
      ms.id,
      ms.matched_worker_id,
      'accepted',
      95,
      900,
      now() - interval '2 hours',
      now() - interval '45 minutes'
    FROM matched_shifts ms
    RETURNING id, shift_id, worker_id
  ),
  open_shifts AS (
    INSERT INTO shifts (
      facility_id, required_role, shift_date, start_time, end_time, hourly_wage,
      estimated_total_pay, description, department, notes, status
    )
    SELECT
      facility_id,
      required_role,
      timezone('Asia/Seoul', now())::date,
      start_time,
      end_time,
      hourly_wage,
      hourly_wage * 8,
      '시연용 오늘 모집 공고입니다. 데모 워커 지원자가 관리자 지원 현황에 표시됩니다.',
      department,
      'DEMO-SHOWCASE-OPEN-' || lpad(rn::text, 4, '0'),
      'open'
    FROM open_seed
    RETURNING id, notes
  ),
  open_apps AS (
    INSERT INTO shift_applications (shift_id, worker_id, status, match_score, distance_meters, applied_at)
    SELECT
      os.id,
      seed.worker_id,
      'applied',
      80 + (seed.rn % 19),
      700 + (seed.rn * 53),
      now() - ((seed.rn % 90) || ' minutes')::interval
    FROM open_shifts os
    JOIN open_seed seed ON os.notes = 'DEMO-SHOWCASE-OPEN-' || lpad(seed.rn::text, 4, '0')
    RETURNING id
  )
  INSERT INTO shift_attendances (shift_id, worker_id, application_id, check_in_at, check_in_method, check_in_distance_m)
  SELECT
    ma.shift_id,
    ma.worker_id,
    ma.id,
    now() - interval '25 minutes',
    'qr',
    80
  FROM matched_apps ma;

  RETURN QUERY
  SELECT 'today_matched_shifts', COUNT(*) FROM shifts WHERE notes LIKE 'DEMO-SHOWCASE-MATCHED-%'
  UNION ALL
  SELECT 'today_open_shifts', COUNT(*) FROM shifts WHERE notes LIKE 'DEMO-SHOWCASE-OPEN-%'
  UNION ALL
  SELECT 'pending_applications', COUNT(*) FROM shift_applications WHERE shift_id IN (
    SELECT id FROM shifts WHERE notes LIKE 'DEMO-SHOWCASE-OPEN-%'
  );
END;
$$;

SELECT * FROM public.refresh_demo_showcase_day();

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'demo_showcase_refresh_0005kst';

SELECT cron.schedule(
  'demo_showcase_refresh_0005kst',
  '5 15 * * *',
  'select public.refresh_demo_showcase_day();'
);
