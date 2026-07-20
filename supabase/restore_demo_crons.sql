-- ============================================================================
-- 데모 자동화 cron 복구 (P0 teardown이 내린 스케줄 재등록)
--   * 매일 00:05 KST — 데모 시프트/지원/매칭 오늘자 재생성 (refresh_demo_showcase_day)
--   * 08/16/00 KST — 데모 워커 위치 회전 (rotate_demo_worker_locations 0/1/2)
--   * 함수 본체는 DB에 이미 존재(2026-07-20 REST 호출로 동작 검증 완료)
--   * 중단하려면: SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'demo_%';
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- 함수가 없으면(예: 다른 환경) 조용히 빈 cron을 걸지 말고 즉시 중단
DO $$
BEGIN
  IF to_regprocedure('public.refresh_demo_showcase_day()') IS NULL THEN
    RAISE EXCEPTION 'refresh_demo_showcase_day 없음 — 20260705102000_demo_showcase_refresh.sql 먼저 실행';
  END IF;
  IF to_regprocedure('public.rotate_demo_worker_locations(integer)') IS NULL THEN
    RAISE EXCEPTION 'rotate_demo_worker_locations 없음 — seed_demo_workers.sql / 20260705101000 먼저 실행';
  END IF;
END $$;

-- 기존 동명 잡 제거 (멱등)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN (
  'demo_showcase_refresh_0005kst',
  'demo_worker_locations_08kst',
  'demo_worker_locations_16kst',
  'demo_worker_locations_00kst'
);

-- 매일 00:05 KST (15:05 UTC) — 오늘자 데모 시프트 재생성
SELECT cron.schedule(
  'demo_showcase_refresh_0005kst',
  '5 15 * * *',
  'select public.refresh_demo_showcase_day();'
);

-- 위치 회전 3회/일 (UTC 기준: 23시=08KST, 07시=16KST, 15시=00KST)
SELECT cron.schedule('demo_worker_locations_08kst', '0 23 * * *', 'select public.rotate_demo_worker_locations(0);');
SELECT cron.schedule('demo_worker_locations_16kst', '0 7 * * *',  'select public.rotate_demo_worker_locations(1);');
SELECT cron.schedule('demo_worker_locations_00kst', '0 15 * * *', 'select public.rotate_demo_worker_locations(2);');

-- 검증: 4개 잡이 보여야 정상
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'demo_%'
ORDER BY jobname;
