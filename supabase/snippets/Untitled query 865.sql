-- 강남세브란스 5km 내 워커 TOP 10 (거리순)
SELECT
  w.name,
  w.role,
  ROUND((ST_Distance(w.activity_center, f.location) / 1000)::numeric, 2) AS km
FROM workers w, facilities f
WHERE f.name = '강남세브란스 요양병원'
  AND w.verification_status = 'approved'
  AND ST_DWithin(w.activity_center, f.location, 5000)
ORDER BY km ASC
LIMIT 10;
