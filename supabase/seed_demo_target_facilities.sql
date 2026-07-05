-- ============================================================================
-- Demo target facilities for Gwangju Gwangsan + Suwon sales simulation
--
-- Generates 100 candidate facilities, selects top 50 by target_score,
-- inserts them as demo facilities, and grants 3 demo operator accounts access.
--
-- Local demo login accounts are created in auth.users:
--   sales-demo-1@demo.atman.co.kr / Atman-demo-2026!
--   sales-demo-2@demo.atman.co.kr / Atman-demo-2026!
--   sales-demo-3@demo.atman.co.kr / Atman-demo-2026!
--
-- Note: admin-web can expose guarded demo email login with:
--   NEXT_PUBLIC_ENABLE_DEMO_LOGIN=1
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

WITH demo_admins(email, display_name) AS (
  VALUES
    ('sales-demo-1@demo.atman.co.kr', '시연 슈퍼계정 1'),
    ('sales-demo-2@demo.atman.co.kr', '시연 슈퍼계정 2'),
    ('sales-demo-3@demo.atman.co.kr', '시연 슈퍼계정 3')
),
upsert_users AS (
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
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

WITH areas(area_code, area_label, base_lng, base_lat) AS (
  VALUES
    ('gwangju_gwangsan', '광주 광산구', 126.8252, 35.1900),
    ('suwon_jangan', '수원 장안구', 127.0106, 37.3037),
    ('suwon_gwonseon', '수원 권선구', 127.0286, 37.2574),
    ('suwon_paldal', '수원 팔달구', 127.0305, 37.2636),
    ('suwon_yeongtong', '수원 영통구', 127.0574, 37.2905)
),
candidate_types(seq, facility_type, type_label, type_score, employee_base) AS (
  VALUES
    (1, 'care_hospital', '요양병원', 35, 85),
    (2, 'nursing_home', '요양원', 30, 55),
    (3, 'small_hospital', '병원', 24, 45),
    (4, 'clinic', '의원', 12, 18)
),
candidates AS (
  SELECT
    a.area_code,
    a.area_label,
    ct.facility_type,
    ct.type_label,
    gs AS local_no,
    a.base_lng + (((gs % 5) - 2) * 0.0075) + ((ct.seq - 2) * 0.0012) AS lng,
    a.base_lat + ((((gs / 5) % 4) - 1.5) * 0.0058) + ((ct.seq - 2) * 0.0010) AS lat,
    ct.employee_base + ((gs * 7 + ct.seq * 11) % 38) AS employee_count,
    ct.type_score
      + CASE WHEN a.area_code = 'gwangju_gwangsan' THEN 8 ELSE 6 END
      + CASE WHEN gs <= 8 THEN 12 WHEN gs <= 14 THEN 7 ELSE 2 END
      + CASE WHEN ct.facility_type IN ('care_hospital', 'nursing_home') THEN 8 ELSE 0 END
      AS target_score
  FROM areas a
  CROSS JOIN generate_series(1, 20) AS gs
  JOIN candidate_types ct ON ct.seq = ((gs - 1) % 4) + 1
),
ranked AS (
  SELECT
    *,
    row_number() OVER (ORDER BY target_score DESC, employee_count DESC, area_code, local_no) AS rank_no
  FROM candidates
),
selected AS (
  SELECT *
  FROM ranked
  WHERE rank_no <= 50
),
inserted AS (
  INSERT INTO facilities (
    name,
    facility_type,
    business_registration_number,
    representative_name,
    address_text,
    location,
    contact_name,
    contact_phone,
    contact_email,
    employee_count,
    plan_code,
    approved_at,
    is_active
  )
  SELECT
    area_label || ' 타깃 ' || type_label || ' ' || lpad(rank_no::text, 2, '0'),
    facility_type,
    'DEMO-TARGET-' || lpad(rank_no::text, 4, '0'),
    '대표자' || lpad(rank_no::text, 2, '0'),
    area_label || ' 데모 영업권역 ' || local_no,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
    '담당자' || lpad(rank_no::text, 2, '0'),
    '010-88' || lpad((rank_no % 100)::text, 2, '0') || '-' ||
      lpad((2000 + rank_no * 13)::text, 4, '0'),
    'target-' || lpad(rank_no::text, 2, '0') || '@demo.atman.local',
    employee_count,
    CASE
      WHEN target_score >= 60 THEN 'bundle'
      WHEN target_score >= 50 THEN 'hr'
      ELSE 'gig'
    END,
    now(),
    true
  FROM selected
  ON CONFLICT (business_registration_number) DO UPDATE SET
    name = EXCLUDED.name,
    facility_type = EXCLUDED.facility_type,
    representative_name = EXCLUDED.representative_name,
    address_text = EXCLUDED.address_text,
    location = EXCLUDED.location,
    contact_name = EXCLUDED.contact_name,
    contact_phone = EXCLUDED.contact_phone,
    contact_email = EXCLUDED.contact_email,
    employee_count = EXCLUDED.employee_count,
    plan_code = EXCLUDED.plan_code,
    approved_at = EXCLUDED.approved_at,
    is_active = true,
    deleted_at = NULL,
    updated_at = now()
  RETURNING id, name, business_registration_number
),
demo_users AS (
  SELECT u.id, u.email
  FROM auth.users u
  WHERE u.email IN ('sales-demo-1@demo.atman.co.kr', 'sales-demo-2@demo.atman.co.kr', 'sales-demo-3@demo.atman.co.kr')
),
access_rows AS (
  SELECT
    du.id AS user_id,
    i.id AS facility_id,
    CASE
      WHEN du.email = 'sales-demo-1@demo.atman.co.kr' THEN 'super'
      WHEN du.email = 'sales-demo-2@demo.atman.co.kr' THEN 'sales'
      ELSE 'operator'
    END AS access_role
  FROM demo_users du
  CROSS JOIN inserted i
)
INSERT INTO facility_admin_access (user_id, facility_id, access_role)
SELECT user_id, facility_id, access_role
FROM access_rows
ON CONFLICT (user_id, facility_id) DO UPDATE SET access_role = EXCLUDED.access_role;

SELECT
  split_part(address_text, ' ', 1) || ' ' || split_part(address_text, ' ', 2) AS area,
  facility_type,
  COUNT(*) AS facilities
FROM facilities
WHERE business_registration_number LIKE 'DEMO-TARGET-%'
GROUP BY area, facility_type
ORDER BY area, facility_type;

SELECT email, COUNT(faa.facility_id) AS accessible_facilities
FROM auth.users u
JOIN facility_admin_access faa ON faa.user_id = u.id
WHERE u.email LIKE 'sales-demo-%@demo.atman.co.kr'
GROUP BY email
ORDER BY email;
