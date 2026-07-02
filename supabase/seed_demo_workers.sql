-- ============================================================================
-- Demo workers for field simulation
-- 광주 광산구 20명 + 수원 4개구 각 20명 = 총 100명
--
-- Usage:
--   1. Run this file once in Supabase SQL editor.
--   2. For location rotation, run:
--        select rotate_demo_worker_locations();
--      The function uses KST hour and moves workers across 3 daily slots.
--      For a specific slot, run:
--        select rotate_demo_worker_locations(0); -- morning
--        select rotate_demo_worker_locations(1); -- afternoon
--        select rotate_demo_worker_locations(2); -- evening/night
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS demo_worker_location_slots (
  area_code TEXT NOT NULL,
  slot_no INTEGER NOT NULL CHECK (slot_no BETWEEN 0 AND 2),
  lng DOUBLE PRECISION NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (area_code, slot_no)
);

INSERT INTO demo_worker_location_slots (area_code, slot_no, lng, lat, label) VALUES
  -- 광주 광산구: 수완/첨단/송정권
  ('gwangju_gwangsan', 0, 126.8252, 35.1900, '광주 광산구 수완동'),
  ('gwangju_gwangsan', 1, 126.8428, 35.2164, '광주 광산구 첨단지구'),
  ('gwangju_gwangsan', 2, 126.7928, 35.1398, '광주 광산구 송정동'),

  -- 수원 장안구: 정자/영화/천천권
  ('suwon_jangan', 0, 127.0106, 37.3037, '수원 장안구 정자동'),
  ('suwon_jangan', 1, 127.0131, 37.2918, '수원 장안구 영화동'),
  ('suwon_jangan', 2, 126.9817, 37.2974, '수원 장안구 천천동'),

  -- 수원 권선구: 권선/호매실/세류권
  ('suwon_gwonseon', 0, 127.0286, 37.2574, '수원 권선구 권선동'),
  ('suwon_gwonseon', 1, 126.9579, 37.2663, '수원 권선구 호매실동'),
  ('suwon_gwonseon', 2, 127.0136, 37.2456, '수원 권선구 세류동'),

  -- 수원 팔달구: 인계/화서/매산권
  ('suwon_paldal', 0, 127.0305, 37.2636, '수원 팔달구 인계동'),
  ('suwon_paldal', 1, 126.9992, 37.2795, '수원 팔달구 화서동'),
  ('suwon_paldal', 2, 127.0001, 37.2660, '수원 팔달구 매산동'),

  -- 수원 영통구: 광교/영통/망포권
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
    CASE WHEN i % 4 = 0 THEN 'na' ELSE 'rn' END AS role
  FROM areas a
  CROSS JOIN generate_series(1, 20) AS i
)
INSERT INTO workers (
  kakao_id,
  name,
  phone,
  email,
  birth_date,
  role,
  activity_center,
  activity_radius_meters,
  activity_address_text,
  verification_status,
  verified_at,
  last_active_at
)
SELECT
  d.kakao_id,
  d.area_label || ' 데모워커 ' || lpad(d.i::text, 2, '0'),
  '010-77' || lpad((abs(hashtext(d.kakao_id)) % 100)::text, 2, '0') || '-' ||
    lpad((1000 + abs(hashtext(d.kakao_id || 'phone')) % 9000)::text, 4, '0'),
  d.kakao_id || '@demo.atman.local',
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
  now()
FROM demo_rows d
ON CONFLICT (kakao_id) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  birth_date = EXCLUDED.birth_date,
  role = EXCLUDED.role,
  verification_status = 'approved',
  verified_at = COALESCE(workers.verified_at, now()),
  deleted_at = NULL,
  updated_at = now();

SELECT * FROM rotate_demo_worker_locations();

SELECT
  CASE
    WHEN kakao_id LIKE 'kakao_demo_gwangju_gwangsan_%' THEN '광주 광산구'
    WHEN kakao_id LIKE 'kakao_demo_suwon_jangan_%' THEN '수원 장안구'
    WHEN kakao_id LIKE 'kakao_demo_suwon_gwonseon_%' THEN '수원 권선구'
    WHEN kakao_id LIKE 'kakao_demo_suwon_paldal_%' THEN '수원 팔달구'
    WHEN kakao_id LIKE 'kakao_demo_suwon_yeongtong_%' THEN '수원 영통구'
  END AS demo_area,
  COUNT(*) AS workers
FROM workers
WHERE kakao_id LIKE 'kakao_demo_%'
GROUP BY demo_area
ORDER BY demo_area;
