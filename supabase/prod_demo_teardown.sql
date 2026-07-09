-- ============================================================================
-- P0-14 · 프로덕션 데모 아티팩트 청소 (수동 실행 전용 — 마이그레이션 아님!)
--
-- 왜 마이그레이션이 아닌가: migrations/ 에 넣으면 로컬·데모 환경 db push 시에도
-- 실행돼 시연 데이터가 사라진다. 이 파일은 **프로덕션 Supabase SQL Editor 에서
-- 한 번만 수동 실행**한다.
--
-- 제거 대상:
--   1) 하드코딩 비번(auth.users)으로 심어진 데모 로그인 계정 (20260705102000_demo_showcase_refresh)
--   2) 존재하지 않는 함수(rotate_demo_worker_locations)를 호출해 하루 3번 실패하는 데모 cron
--      (20260705101000_demo_worker_location_cron) + 데모 showcase refresh cron
-- ============================================================================

-- ── 1. 실패/불필요한 데모 크론 해제 ──────────────────────────────────────────
DO $$
DECLARE j RECORD;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE command ILIKE '%rotate_demo_worker_locations%'
       OR command ILIKE '%demo_showcase%'
       OR command ILIKE '%refresh_demo%'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron 미설치 환경 — 건너뜀';
END $$;

-- 확인:  SELECT jobid, schedule, command FROM cron.job;

-- ── 2. 데모 로그인 계정 제거 (프로덕션에서만!) ──────────────────────────────
-- shifts.matched_worker_id 가 데모 워커를 참조하면 FK(23503) 로 DELETE 가 막힘.
-- 먼저 NULL 로 해제한 뒤 삭제한다.
UPDATE shifts
SET matched_worker_id = NULL
WHERE matched_worker_id IN (
  SELECT w.id FROM workers w
  JOIN auth.users u ON u.id = w.auth_user_id
  WHERE u.email LIKE '%@demo.atman.co.kr'
);

-- profiles·workers·shift_applications 등 연결 데이터는 FK CASCADE 로 함께 정리됨.
-- 실행 전 반드시 대상 확인:
--   SELECT id, email FROM auth.users WHERE email LIKE '%@demo.atman.co.kr';
DELETE FROM auth.users WHERE email LIKE '%@demo.atman.co.kr';

-- ── 3. (선택) 데모 플래그 시설/워커 정리 ────────────────────────────────────
-- is_demo 로 심어진 쇼케이스 데이터가 프로덕션에 남아 있으면 아래로 정리:
--   DELETE FROM workers   WHERE is_demo = TRUE;
--   -- facilities 에 is_demo 컬럼이 있다면:  DELETE FROM facilities WHERE is_demo = TRUE;
-- 실제 병원/워커를 지우지 않도록 SELECT 로 먼저 확인 후 주석 해제할 것.

-- ============================================================================
-- 근본 대책(후속): 데모 seed/cron 을 migrations/ 에서 제거하고
-- supabase/seed_demo_*.sql 로만 유지 → 데모 프로젝트에서만 수동 적용.
-- 그래야 앞으로 db push 가 프로덕션에 데모 데이터를 다시 심지 않는다.
-- ============================================================================
