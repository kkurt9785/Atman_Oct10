-- ============================================================================
-- Sales/demo showcase data
--
-- Scope:
--   - 50 target facilities across Gwangju Gwangsan + Suwon 4 districts
--   - 100 demo workers, 20 per area, RN/NA mixed
--   - 3 daily location slots via rotate_demo_worker_locations()
--   - Today showcase shifts: 1 matched/in-progress + 1 open/pending per facility
--
-- Notes:
--   Facility names are sales-target demo data based on public search candidates.
--   Verify exact operating status/contact owner before real outreach.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

WITH demo_admins(email, display_name) AS (
  VALUES
    ('sales-demo-1@demo.atman.co.kr', '시연 슈퍼계정 1'),
    ('sales-demo-2@demo.atman.co.kr', '시연 슈퍼계정 2'),
    ('sales-demo-3@demo.atman.co.kr', '시연 슈퍼계정 3')
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
  FROM demo_admins
  ON CONFLICT (email) WHERE is_sso_user = false DO UPDATE SET
    encrypted_password = EXCLUDED.encrypted_password,
    raw_user_meta_data = EXCLUDED.raw_user_meta_data,
    updated_at = now()
  RETURNING id, email
)
INSERT INTO profiles (id, role, onboarding_done)
SELECT id, 'admin', true FROM upsert_users
ON CONFLICT (id) DO UPDATE SET
  role = 'admin',
  onboarding_done = true,
  updated_at = now();

CREATE TABLE IF NOT EXISTS demo_worker_location_slots (
  area_code TEXT NOT NULL,
  slot_no INTEGER NOT NULL CHECK (slot_no BETWEEN 0 AND 2),
  lng DOUBLE PRECISION NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (area_code, slot_no)
);

INSERT INTO demo_worker_location_slots (area_code, slot_no, lng, lat, label) VALUES
  ('gwangju_gwangsan', 0, 126.8252, 35.1900, '광주 광산구 수완동'),
  ('gwangju_gwangsan', 1, 126.8428, 35.2164, '광주 광산구 첨단지구'),
  ('gwangju_gwangsan', 2, 126.7928, 35.1398, '광주 광산구 송정동'),
  ('suwon_jangan', 0, 127.0106, 37.3037, '수원 장안구 정자동'),
  ('suwon_jangan', 1, 127.0131, 37.2918, '수원 장안구 영화동'),
  ('suwon_jangan', 2, 126.9817, 37.2974, '수원 장안구 천천동'),
  ('suwon_gwonseon', 0, 127.0286, 37.2574, '수원 권선구 권선동'),
  ('suwon_gwonseon', 1, 126.9579, 37.2663, '수원 권선구 호매실동'),
  ('suwon_gwonseon', 2, 127.0136, 37.2456, '수원 권선구 세류동'),
  ('suwon_paldal', 0, 127.0305, 37.2636, '수원 팔달구 인계동'),
  ('suwon_paldal', 1, 126.9992, 37.2795, '수원 팔달구 화서동'),
  ('suwon_paldal', 2, 127.0001, 37.2660, '수원 팔달구 매산동'),
  ('suwon_yeongtong', 0, 127.0574, 37.2905, '수원 영통구 광교'),
  ('suwon_yeongtong', 1, 127.0738, 37.2516, '수원 영통구 영통동'),
  ('suwon_yeongtong', 2, 127.0562, 37.2384, '수원 영통구 망포동')
ON CONFLICT (area_code, slot_no) DO UPDATE SET
  lng = EXCLUDED.lng,
  lat = EXCLUDED.lat,
  label = EXCLUDED.label;

CREATE OR REPLACE FUNCTION rotate_demo_worker_locations(p_slot INTEGER DEFAULT NULL)
RETURNS TABLE(area_code TEXT, worker_count BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_slot INTEGER;
BEGIN
  v_slot := COALESCE(
    p_slot,
    CASE
      WHEN EXTRACT(HOUR FROM timezone('Asia/Seoul', now())) < 8 THEN 0
      WHEN EXTRACT(HOUR FROM timezone('Asia/Seoul', now())) < 16 THEN 1
      ELSE 2
    END
  );

  IF v_slot NOT BETWEEN 0 AND 2 THEN
    RAISE EXCEPTION 'slot must be 0, 1, or 2';
  END IF;

  UPDATE workers w
  SET
    activity_center = ST_SetSRID(
      ST_MakePoint(
        s.lng + ((((substring(w.kakao_id from '([0-9]+)$'))::int % 5) - 2) * 0.0022),
        s.lat + (((((substring(w.kakao_id from '([0-9]+)$'))::int / 5) % 4) - 1.5) * 0.0018)
      ),
      4326
    )::geography,
    activity_address_text = s.label,
    activity_radius_meters = 12000,
    last_active_at = now(),
    updated_at = now()
  FROM demo_worker_location_slots s
  WHERE s.slot_no = v_slot
    AND w.kakao_id LIKE 'kakao_demo_' || s.area_code || '_%';

  RETURN QUERY
  SELECT s.area_code, COUNT(w.id)
  FROM demo_worker_location_slots s
  LEFT JOIN workers w ON w.kakao_id LIKE 'kakao_demo_' || s.area_code || '_%'
  WHERE s.slot_no = v_slot
  GROUP BY s.area_code
  ORDER BY s.area_code;
END;
$$;

WITH target_facilities(rank_no, area_code, area_label, name, facility_type, address_hint, lng, lat, employee_count, plan_code) AS (
  VALUES
    (1, 'gwangju_gwangsan', '광주 광산구', 'W여성병원', 'small_hospital', '수완동', 126.8252, 35.1900, 120, 'bundle'),
    (2, 'gwangju_gwangsan', '광주 광산구', 'KS병원', 'general_hospital', '수완동', 126.8240, 35.1886, 180, 'bundle'),
    (3, 'gwangju_gwangsan', '광주 광산구', '광주보훈병원', 'general_hospital', '산월동', 126.8450, 35.2075, 260, 'enterprise'),
    (4, 'gwangju_gwangsan', '광주 광산구', '첨단종합병원', 'general_hospital', '첨단지구', 126.8480, 35.2152, 180, 'bundle'),
    (5, 'gwangju_gwangsan', '광주 광산구', '수완센트럴병원', 'small_hospital', '수완동', 126.8210, 35.1894, 80, 'bundle'),
    (6, 'gwangju_gwangsan', '광주 광산구', '하남성심병원', 'small_hospital', '하남동', 126.8030, 35.1760, 90, 'bundle'),
    (7, 'gwangju_gwangsan', '광주 광산구', '첨단요양병원', 'care_hospital', '첨단지구', 126.8428, 35.2164, 95, 'bundle'),
    (8, 'gwangju_gwangsan', '광주 광산구', '수완행복한요양병원', 'care_hospital', '수완동', 126.8265, 35.1910, 70, 'hr'),
    (9, 'gwangju_gwangsan', '광주 광산구', '산들요양병원', 'care_hospital', '신가동', 126.8335, 35.1825, 65, 'hr'),
    (10, 'gwangju_gwangsan', '광주 광산구', '호남THE선요양병원', 'care_hospital', '송정동', 126.7928, 35.1398, 65, 'hr'),
    (11, 'suwon_jangan', '수원 장안구', '경기도의료원 수원병원', 'general_hospital', '정자동', 127.0106, 37.3037, 220, 'enterprise'),
    (12, 'suwon_jangan', '수원 장안구', '메디움수원요양병원', 'care_hospital', '정자동', 127.0088, 37.3028, 85, 'bundle'),
    (13, 'suwon_jangan', '수원 장안구', '수원효요양병원', 'care_hospital', '영화동', 127.0131, 37.2918, 75, 'hr'),
    (14, 'suwon_jangan', '수원 장안구', '수원행복한요양병원', 'care_hospital', '천천동', 126.9817, 37.2974, 70, 'hr'),
    (15, 'suwon_jangan', '수원 장안구', '수원삼성요양병원', 'care_hospital', '송죽동', 127.0060, 37.2970, 70, 'hr'),
    (16, 'suwon_jangan', '수원 장안구', '스마일요양병원', 'care_hospital', '조원동', 127.0150, 37.3010, 60, 'hr'),
    (17, 'suwon_jangan', '수원 장안구', '연세수요양병원', 'care_hospital', '파장동', 126.9950, 37.3105, 60, 'hr'),
    (18, 'suwon_jangan', '수원 장안구', '한빛현요양병원', 'care_hospital', '율전동', 126.9720, 37.3000, 65, 'hr'),
    (19, 'suwon_jangan', '수원 장안구', '성모척관병원', 'small_hospital', '정자동', 127.0118, 37.2992, 45, 'gig'),
    (20, 'suwon_jangan', '수원 장안구', '화홍병원', 'small_hospital', '영화동', 127.0138, 37.2898, 60, 'hr'),
    (21, 'suwon_gwonseon', '수원 권선구', '서수원병원', 'small_hospital', '고색동', 126.9850, 37.2505, 110, 'bundle'),
    (22, 'suwon_gwonseon', '수원 권선구', '수원센트럴요양병원', 'care_hospital', '권선동', 127.0286, 37.2574, 75, 'hr'),
    (23, 'suwon_gwonseon', '수원 권선구', '수원하나요양병원', 'care_hospital', '권선동', 127.0245, 37.2560, 75, 'hr'),
    (24, 'suwon_gwonseon', '수원 권선구', '서울삼성호매실요양병원', 'care_hospital', '호매실동', 126.9579, 37.2663, 80, 'bundle'),
    (25, 'suwon_gwonseon', '수원 권선구', '메이저요양병원', 'care_hospital', '권선동', 127.0200, 37.2598, 70, 'hr'),
    (26, 'suwon_gwonseon', '수원 권선구', '수원요양병원', 'care_hospital', '세류동', 127.0136, 37.2456, 70, 'hr'),
    (27, 'suwon_gwonseon', '수원 권선구', '경희프라임한방병원', 'small_hospital', '호매실동', 126.9600, 37.2640, 45, 'gig'),
    (28, 'suwon_gwonseon', '수원 권선구', '성모수메디컬의원', 'clinic', '권선동', 127.0260, 37.2585, 28, 'gig'),
    (29, 'suwon_gwonseon', '수원 권선구', '아이온연합소아청소년과의원', 'clinic', '호매실동', 126.9560, 37.2678, 24, 'gig'),
    (30, 'suwon_gwonseon', '수원 권선구', '호매실원정형외과의원', 'clinic', '호매실동', 126.9588, 37.2650, 28, 'gig'),
    (31, 'suwon_paldal', '수원 팔달구', '가톨릭대학교 성빈센트병원', 'general_hospital', '지동', 127.0276, 37.2776, 420, 'enterprise'),
    (32, 'suwon_paldal', '수원 팔달구', '동수원병원', 'general_hospital', '우만동', 127.0356, 37.2782, 180, 'bundle'),
    (33, 'suwon_paldal', '수원 팔달구', '윌스기념병원', 'small_hospital', '인계동', 127.0305, 37.2636, 130, 'bundle'),
    (34, 'suwon_paldal', '수원 팔달구', '쉬즈메디병원', 'small_hospital', '인계동', 127.0292, 37.2644, 100, 'bundle'),
    (35, 'suwon_paldal', '수원 팔달구', '수원힐요양병원', 'care_hospital', '화서동', 126.9992, 37.2795, 70, 'hr'),
    (36, 'suwon_paldal', '수원 팔달구', '위더스요양병원', 'care_hospital', '매산동', 127.0001, 37.2660, 70, 'hr'),
    (37, 'suwon_paldal', '수원 팔달구', '팔달요양병원', 'care_hospital', '고등동', 127.0008, 37.2736, 65, 'hr'),
    (38, 'suwon_paldal', '수원 팔달구', '효정요양병원', 'care_hospital', '우만동', 127.0365, 37.2762, 60, 'hr'),
    (39, 'suwon_paldal', '수원 팔달구', '해성병원', 'small_hospital', '매산동', 127.0028, 37.2675, 55, 'hr'),
    (40, 'suwon_paldal', '수원 팔달구', '백성병원', 'small_hospital', '인계동', 127.0325, 37.2650, 55, 'hr'),
    (41, 'suwon_yeongtong', '수원 영통구', '아주대학교병원', 'general_hospital', '원천동', 127.0475, 37.2796, 520, 'enterprise'),
    (42, 'suwon_yeongtong', '수원 영통구', '시온여성병원', 'small_hospital', '영통동', 127.0738, 37.2516, 110, 'bundle'),
    (43, 'suwon_yeongtong', '수원 영통구', '베데스다재활병원', 'small_hospital', '영통동', 127.0715, 37.2525, 90, 'bundle'),
    (44, 'suwon_yeongtong', '수원 영통구', '광교참재활요양병원', 'care_hospital', '광교', 127.0574, 37.2905, 85, 'bundle'),
    (45, 'suwon_yeongtong', '수원 영통구', '영통효요양병원', 'care_hospital', '영통동', 127.0750, 37.2500, 70, 'hr'),
    (46, 'suwon_yeongtong', '수원 영통구', '연세모아요양병원', 'care_hospital', '망포동', 127.0562, 37.2384, 70, 'hr'),
    (47, 'suwon_yeongtong', '수원 영통구', '아주대학교요양병원', 'care_hospital', '원천동', 127.0490, 37.2810, 75, 'hr'),
    (48, 'suwon_yeongtong', '수원 영통구', '수원요양병원', 'care_hospital', '매탄동', 127.0415, 37.2650, 70, 'hr'),
    (49, 'suwon_yeongtong', '수원 영통구', '매듭병원', 'small_hospital', '망포동', 127.0580, 37.2395, 45, 'gig'),
    (50, 'suwon_yeongtong', '수원 영통구', '광교윌내과의원', 'clinic', '광교', 127.0600, 37.2890, 25, 'gig')
),
upserted_facilities AS (
  INSERT INTO facilities (
    name, facility_type, business_registration_number, representative_name,
    address_text, location, contact_name, contact_phone, contact_email,
    employee_count, plan_code, approved_at, is_active, is_demo
  )
  SELECT
    name,
    facility_type,
    'DEMO-TARGET-' || lpad(rank_no::text, 4, '0'),
    '영업타깃',
    area_label || ' ' || address_hint,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
    '간호부 담당자',
    '010-88' || lpad((rank_no % 100)::text, 2, '0') || '-' || lpad((2000 + rank_no * 13)::text, 4, '0'),
    'target-' || lpad(rank_no::text, 2, '0') || '@demo.atman.co.kr',
    employee_count,
    plan_code,
    now(),
    true,
    true
  FROM target_facilities
  ON CONFLICT (business_registration_number) DO UPDATE SET
    name = EXCLUDED.name,
    facility_type = EXCLUDED.facility_type,
    address_text = EXCLUDED.address_text,
    location = EXCLUDED.location,
    contact_name = EXCLUDED.contact_name,
    contact_phone = EXCLUDED.contact_phone,
    contact_email = EXCLUDED.contact_email,
    employee_count = EXCLUDED.employee_count,
    plan_code = EXCLUDED.plan_code,
    approved_at = EXCLUDED.approved_at,
    is_active = true,
    is_demo = true,
    deleted_at = NULL,
    updated_at = now()
  RETURNING id, business_registration_number
),
demo_users AS (
  SELECT u.id, u.email
  FROM auth.users u
  WHERE u.email IN ('sales-demo-1@demo.atman.co.kr', 'sales-demo-2@demo.atman.co.kr', 'sales-demo-3@demo.atman.co.kr')
)
INSERT INTO facility_admin_access (user_id, facility_id, access_role)
SELECT
  du.id,
  uf.id,
  CASE
    WHEN du.email = 'sales-demo-1@demo.atman.co.kr' THEN 'super'
    WHEN du.email = 'sales-demo-2@demo.atman.co.kr' THEN 'sales'
    ELSE 'operator'
  END
FROM demo_users du
CROSS JOIN upserted_facilities uf
ON CONFLICT (user_id, facility_id) DO UPDATE SET access_role = EXCLUDED.access_role;

WITH areas(area_code, area_label, base_lng, base_lat) AS (
  VALUES
    ('gwangju_gwangsan', '광주 광산구', 126.8252, 35.1900),
    ('suwon_jangan', '수원 장안구', 127.0106, 37.3037),
    ('suwon_gwonseon', '수원 권선구', 127.0286, 37.2574),
    ('suwon_paldal', '수원 팔달구', 127.0305, 37.2636),
    ('suwon_yeongtong', '수원 영통구', 127.0574, 37.2905)
),
demo_rows AS (
  SELECT
    a.*,
    i,
    'kakao_demo_' || a.area_code || '_' || lpad(i::text, 2, '0') AS kakao_id,
    CASE WHEN i % 3 = 0 THEN 'na' ELSE 'rn' END AS role
  FROM areas a
  CROSS JOIN generate_series(1, 20) AS i
)
INSERT INTO workers (
  kakao_id, name, phone, email, birth_date, role, activity_center,
  activity_radius_meters, activity_address_text, verification_status,
  verified_at, last_active_at, license_number, experience_years,
  last_workplace, department_tags, is_demo
)
SELECT
  d.kakao_id,
  d.area_label || ' 데모워커 ' || lpad(d.i::text, 2, '0'),
  '010-77' || lpad((abs(hashtext(d.kakao_id)) % 100)::text, 2, '0') || '-' ||
    lpad((1000 + abs(hashtext(d.kakao_id || 'phone')) % 9000)::text, 4, '0'),
  d.kakao_id || '@demo.atman.co.kr',
  make_date(1980 + (d.i % 18), 1 + (d.i % 12), 1 + (d.i % 27)),
  d.role,
  ST_SetSRID(
    ST_MakePoint(
      d.base_lng + (((d.i % 5) - 2) * 0.0022),
      d.base_lat + ((((d.i / 5) % 4) - 1.5) * 0.0018)
    ),
    4326
  )::geography,
  12000,
  d.area_label,
  'approved',
  now(),
  now(),
  CASE WHEN d.role = 'rn' THEN 'RN-DEMO-' ELSE 'NA-DEMO-' END || lpad(d.i::text, 5, '0'),
  CASE WHEN d.i % 4 = 0 THEN '5년 이상' WHEN d.i % 4 = 1 THEN '3~5년' ELSE '1~3년' END,
  d.area_label || ' 종합병원',
  CASE WHEN d.role = 'rn' THEN ARRAY['일반병동', '응급실'] ELSE ARRAY['요양병원', '간병지원'] END,
  true
FROM demo_rows d
ON CONFLICT (kakao_id) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  birth_date = EXCLUDED.birth_date,
  role = EXCLUDED.role,
  verification_status = 'approved',
  verified_at = COALESCE(workers.verified_at, now()),
  license_number = EXCLUDED.license_number,
  experience_years = EXCLUDED.experience_years,
  last_workplace = EXCLUDED.last_workplace,
  department_tags = EXCLUDED.department_tags,
  is_demo = true,
  deleted_at = NULL,
  updated_at = now();

SELECT * FROM rotate_demo_worker_locations();

WITH demo_shifts AS (
  SELECT id FROM shifts WHERE notes LIKE 'DEMO-SHOWCASE-%'
)
DELETE FROM shift_attendances
WHERE shift_id IN (SELECT id FROM demo_shifts);

WITH demo_shifts AS (
  SELECT id FROM shifts WHERE notes LIKE 'DEMO-SHOWCASE-%'
)
DELETE FROM shift_applications
WHERE shift_id IN (SELECT id FROM demo_shifts);

DELETE FROM shifts
WHERE notes LIKE 'DEMO-SHOWCASE-%';

WITH ranked_facilities AS (
  SELECT
    f.*,
    row_number() OVER (ORDER BY f.business_registration_number) AS rn
  FROM facilities f
  WHERE f.business_registration_number LIKE 'DEMO-TARGET-%'
),
ranked_workers AS (
  SELECT
    w.*,
    row_number() OVER (ORDER BY w.kakao_id) AS rn
  FROM workers w
  WHERE w.kakao_id LIKE 'kakao_demo_%'
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
  RETURNING id, matched_worker_id, notes
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

SELECT
  'facilities' AS kind,
  COUNT(*) AS count
FROM facilities
WHERE is_demo = true AND business_registration_number LIKE 'DEMO-TARGET-%'
UNION ALL
SELECT 'workers', COUNT(*) FROM workers WHERE is_demo = true AND kakao_id LIKE 'kakao_demo_%'
UNION ALL
SELECT 'today_matched_shifts', COUNT(*) FROM shifts WHERE notes LIKE 'DEMO-SHOWCASE-MATCHED-%'
UNION ALL
SELECT 'today_open_shifts', COUNT(*) FROM shifts WHERE notes LIKE 'DEMO-SHOWCASE-OPEN-%'
UNION ALL
SELECT 'pending_applications', COUNT(*) FROM shift_applications WHERE shift_id IN (
  SELECT id FROM shifts WHERE notes LIKE 'DEMO-SHOWCASE-OPEN-%'
);
