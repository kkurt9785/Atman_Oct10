-- ============================================================================
-- Atman PoC Seed Data
-- 10 시설 (강남 중심) + 100 워커 (서울 분산)
-- 목적: PostGIS 반경 매칭 성능 검증
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 시설 10개 (서울 주요 병원 좌표)
-- ----------------------------------------------------------------------------
INSERT INTO facilities (name, facility_type, business_registration_number, address_text, location, contact_name, contact_phone, contact_email) VALUES
  ('강남세브란스 요양병원', 'care_hospital', '123-45-00001', '서울 강남구 도곡동 123', ST_SetSRID(ST_MakePoint(127.0432, 37.4915), 4326)::geography, '김원장', '02-1234-5678', 'gn-severance@test.kr'),
  ('서울대병원 간호간병통합', 'general_hospital', '123-45-00002', '서울 종로구 대학로 101', ST_SetSRID(ST_MakePoint(127.0035, 37.5800), 4326)::geography, '이팀장', '02-2345-6789', 'snuh@test.kr'),
  ('신촌세브란스 야간센터', 'general_hospital', '123-45-00003', '서울 서대문구 연세로 50', ST_SetSRID(ST_MakePoint(126.9408, 37.5620), 4326)::geography, '박매니저', '02-3456-7890', 'severance@test.kr'),
  ('역삼 요양원', 'nursing_home', '123-45-00004', '서울 강남구 역삼동 678', ST_SetSRID(ST_MakePoint(127.0364, 37.5006), 4326)::geography, '최원장', '02-4567-8901', 'yeoksam@test.kr'),
  ('압구정 케어홈', 'nursing_home', '123-45-00005', '서울 강남구 압구정동 99', ST_SetSRID(ST_MakePoint(127.0286, 37.5276), 4326)::geography, '정원장', '02-5678-9012', 'apgujeong@test.kr'),
  ('잠실 시니어 의원', 'clinic', '123-45-00006', '서울 송파구 잠실동 33', ST_SetSRID(ST_MakePoint(127.1000, 37.5132), 4326)::geography, '한팀장', '02-6789-0123', 'jamsil@test.kr'),
  ('마포 요양병원', 'care_hospital', '123-45-00007', '서울 마포구 공덕동 7', ST_SetSRID(ST_MakePoint(126.9520, 37.5450), 4326)::geography, '윤원장', '02-7890-1234', 'mapo@test.kr'),
  ('영등포 야간병동', 'small_hospital', '123-45-00008', '서울 영등포구 여의도동 15', ST_SetSRID(ST_MakePoint(126.9244, 37.5240), 4326)::geography, '강매니저', '02-8901-2345', 'ydp@test.kr'),
  ('성동 노인병원', 'care_hospital', '123-45-00009', '서울 성동구 왕십리로 200', ST_SetSRID(ST_MakePoint(127.0419, 37.5610), 4326)::geography, '오원장', '02-9012-3456', 'sd@test.kr'),
  ('관악 의원', 'clinic', '123-45-00010', '서울 관악구 신림동 1', ST_SetSRID(ST_MakePoint(126.9300, 37.4840), 4326)::geography, '임원장', '02-0123-4567', 'gwanak@test.kr');

-- ----------------------------------------------------------------------------
-- 워커 100명 (서울 범위 랜덤 분산, 70% RN / 30% NA)
-- 활동 반경 3-30km 랜덤
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  i INT;
  v_lat NUMERIC;
  v_lng NUMERIC;
  v_role TEXT;
  v_birth_year INT;
BEGIN
  FOR i IN 1..100 LOOP
    -- 서울 bbox: lat 37.42~37.70, lng 126.80~127.20
    v_lat := 37.42 + random() * 0.28;
    v_lng := 126.80 + random() * 0.40;
    v_role := CASE WHEN random() < 0.7 THEN 'rn' ELSE 'na' END;
    v_birth_year := 1971 + (random() * 33)::int;  -- 22-55세 (2026 기준)

    INSERT INTO workers (
      kakao_id, name, phone, email, birth_date,
      role, activity_center, activity_radius_meters,
      verification_status, verified_at
    ) VALUES (
      'kakao_seed_' || i,
      '간호사' || lpad(i::text, 3, '0'),
      '010-' || lpad((1000 + (random() * 8999)::int)::text, 4, '0') ||
        '-' || lpad((random() * 9999)::int::text, 4, '0'),
      'nurse' || i || '@test.kr',
      make_date(v_birth_year, (1 + (random() * 11)::int), (1 + (random() * 27)::int)),
      v_role,
      ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography,
      (3 + (random() * 9)::int) * 1000,  -- 3km~12km 일반적 통근권
      'approved',
      NOW()
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 푸시 토큰 (워커당 1개씩 가상 토큰)
-- ----------------------------------------------------------------------------
INSERT INTO push_tokens (worker_id, expo_token, platform)
SELECT
  id,
  'ExponentPushToken[' || substr(md5(random()::text), 1, 22) || ']',
  CASE WHEN random() < 0.55 THEN 'ios' ELSE 'android' END
FROM workers;

-- ----------------------------------------------------------------------------
-- 검증 출력
-- ----------------------------------------------------------------------------
SELECT
  '시설' AS entity, COUNT(*) AS count
FROM facilities
UNION ALL
SELECT '워커 (승인)', COUNT(*) FROM workers WHERE verification_status = 'approved'
UNION ALL
SELECT '워커 - RN', COUNT(*) FROM workers WHERE role = 'rn'
UNION ALL
SELECT '워커 - NA', COUNT(*) FROM workers WHERE role = 'na'
UNION ALL
SELECT '푸시 토큰', COUNT(*) FROM push_tokens;
