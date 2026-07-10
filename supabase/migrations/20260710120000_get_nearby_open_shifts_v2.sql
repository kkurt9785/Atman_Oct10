-- ============================================================================
-- get_nearby_open_shifts_v2 — 이중 기준 근처 시프트 조회
--
-- 매칭 기준 (합집합, 가까운 쪽 거리로 정렬):
--   1) GPS 슬롯   — 클라이언트가 넘긴 현재 위치 (p_lat/p_lng), 반경 12km
--   2) 지역 슬롯   — worker_location_prefs.locations 의 수동 선택 지역들
--   3) 폴백       — 둘 다 없으면 workers.activity_center (기존 v1 동작)
--
-- v1(get_nearby_open_shifts)은 activity_center 1개만 봐서 두 번째 등록 지역이
-- 매칭에 반영되지 않던 문제를 함께 해결한다.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_nearby_open_shifts_v2(
  p_auth_user_id uuid,
  p_roles text[],
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  facility_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  is_overnight boolean,
  required_role text,
  hourly_wage numeric,
  estimated_total_pay numeric,
  description text,
  department text,
  notes text,
  facility_name text,
  address_text text,
  distance_m double precision,
  matched_by text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH me AS (
  SELECT w.activity_center, COALESCE(w.activity_radius_meters, 12000)::double precision AS radius_m
  FROM workers w
  WHERE w.auth_user_id = p_auth_user_id
),
prefs AS (
  SELECT
    ST_SetSRID(ST_MakePoint((l->>'lng')::double precision, (l->>'lat')::double precision), 4326)::geography AS center,
    COALESCE((l->>'radius_km')::double precision, 12) * 1000 AS radius_m
  FROM worker_location_prefs p
  CROSS JOIN LATERAL jsonb_array_elements(p.locations) AS l
  WHERE p.worker_id = p_auth_user_id
    AND (l->>'lat') IS NOT NULL
    AND (l->>'lng') IS NOT NULL
),
centers AS (
  -- 1) GPS 현재 위치
  SELECT
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography AS center,
    12000::double precision AS radius_m,
    'gps'::text AS src
  WHERE p_lat IS NOT NULL AND p_lng IS NOT NULL
  UNION ALL
  -- 2) 수동 선택 지역들
  SELECT center, radius_m, 'pref' FROM prefs
  UNION ALL
  -- 3) 폴백: 대표 활동지역 (GPS도 지역 설정도 없을 때)
  SELECT m.activity_center, m.radius_m, 'fallback'
  FROM me m
  WHERE m.activity_center IS NOT NULL
    AND (p_lat IS NULL OR p_lng IS NULL)
    AND NOT EXISTS (SELECT 1 FROM prefs)
)
SELECT
  s.id,
  s.facility_id,
  s.shift_date,
  s.start_time,
  s.end_time,
  s.is_overnight,
  s.required_role::text,
  s.hourly_wage::numeric,
  s.estimated_total_pay::numeric,
  s.description,
  s.department,
  s.notes,
  f.name AS facility_name,
  f.address_text,
  MIN(ST_Distance(f.location, c.center)) AS distance_m,
  (array_agg(c.src ORDER BY ST_Distance(f.location, c.center)))[1] AS matched_by
FROM shifts s
JOIN facilities f ON f.id = s.facility_id
JOIN centers c ON ST_DWithin(f.location, c.center, c.radius_m)
WHERE s.status::text = 'open'
  AND s.shift_date >= (timezone('Asia/Seoul', now()))::date
  AND s.required_role::text = ANY (p_roles)
GROUP BY
  s.id, s.facility_id, s.shift_date, s.start_time, s.end_time, s.is_overnight,
  s.required_role, s.hourly_wage, s.estimated_total_pay, s.description,
  s.department, s.notes, f.name, f.address_text
ORDER BY distance_m ASC, s.shift_date ASC;
$$;

GRANT EXECUTE ON FUNCTION get_nearby_open_shifts_v2(uuid, text[], double precision, double precision) TO authenticated;
