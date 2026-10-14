-- ============================================================================
-- 시연 철수(데모 종료) — 수동 실행 전용. 마이그레이션 아님! (운영 Supabase SQL Editor)
--
-- 목표: 시연과 운영이 한 버전에서 같이 돌다가, 시연이 끝나면 데모 워커·데모 사업장이
--       실제 사용자 화면에서 '자연스럽게' 사라진다. 코드 배포 없이 데이터·스위치만으로.
--
-- 단계
--   0. PREVIEW  — 지울 대상 수를 먼저 본다(읽기만).
--   1. RETIRE   — 되돌릴 수 있는 끄기. 기존 필터가 보는 컬럼만 바꾼다:
--                 facilities.is_active=false·deleted_at / workers.deleted_at / 데모 공고 취소 /
--                 데모 로그인 계정 정지(banned) / 데모 pg_cron 해제 / 마스터 초대코드 OFF
--                 → 공개 공고·근처 공고·근무자 검색·초대 수락·시연 로그인이 전부 막힌다.
--   2. PURGE    — (선택, 되돌릴 수 없음) FK 순서대로 하드 삭제. 시연 데이터엔 실명 개인정보가
--                 없으므로 급하지 않다. 운영 통계에서 데모를 완전히 빼고 싶을 때만.
--
-- 앱 쪽 스위치(이 파일 밖, Vercel 환경변수 → 두 앱 재배포)
--   NEXT_PUBLIC_ENABLE_DEMO_LOGIN=0   (admin-web·worker-web) 시연 버튼·/api/demo-login·/demo·/gig/demo 숨김
--   DEMO_SHOWCASE_ENABLED=false       (admin-web) expire-shifts 크론이 매일 08:30 돌리는 revive 중지
-- 식별 기준
--   사업장: facilities.is_demo = true (사업자번호 'DEMO-TARGET-%')
--   근무자: workers.is_demo = true OR kakao_id LIKE 'kakao_demo_%'
--   계정:   auth.users.email LIKE '%@demo.atman.co.kr' (sales-demo-1~3, worker-demo-*, worker-gig-demo)
-- ============================================================================


-- ─── 0. PREVIEW (읽기만) ───────────────────────────────────────────────────────
SELECT 'facilities(demo)' AS what, count(*) FROM public.facilities WHERE is_demo
UNION ALL SELECT 'facilities(demo, 아직 active)', count(*) FROM public.facilities WHERE is_demo AND is_active AND deleted_at IS NULL
UNION ALL SELECT 'workers(demo)', count(*) FROM public.workers WHERE is_demo OR kakao_id LIKE 'kakao_demo_%'
UNION ALL SELECT 'workers(demo, 아직 활성)', count(*) FROM public.workers WHERE (is_demo OR kakao_id LIKE 'kakao_demo_%') AND deleted_at IS NULL
UNION ALL SELECT 'auth.users(@demo)', count(*) FROM auth.users WHERE email LIKE '%@demo.atman.co.kr'
UNION ALL SELECT 'shifts(demo, open/in_progress)', count(*) FROM public.shifts s JOIN public.facilities f ON f.id=s.facility_id WHERE f.is_demo AND s.status IN ('open','in_progress')
UNION ALL SELECT 'pg_cron demo jobs', count(*) FROM cron.job WHERE jobname ILIKE '%demo%'
UNION ALL SELECT 'master_invite_enabled', count(*) FROM public.app_demo_settings WHERE master_invite_enabled;
-- 실제 사업장이 is_demo 로 잘못 찍히지 않았는지 이름으로 한 번 훑는다:
-- SELECT id, name, business_registration_number FROM public.facilities WHERE is_demo ORDER BY name;


-- ─── 1. RETIRE (되돌릴 수 있음) ────────────────────────────────────────────────
BEGIN;

-- 1-a. 데모 자동화 크론 해제 (revive 는 Vercel 환경변수 DEMO_SHOWCASE_ENABLED=false 로 따로)
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid, jobname FROM cron.job WHERE jobname ILIKE '%demo%' LOOP
    PERFORM cron.unschedule(j.jobid);
    RAISE NOTICE 'unscheduled %', j.jobname;
  END LOOP;
END $$;

-- 1-b. 마스터 초대코드 OFF (켜져 있으면 코드 하나로 아무 사업장 관리자 연결 가능)
UPDATE public.app_demo_settings SET master_invite_enabled = false WHERE master_invite_enabled;

-- 1-c. 데모 공고는 취소 — 근처 공고·공개 공고·지원 RPC 가 status='open' 만 보므로 즉시 사라진다
UPDATE public.shifts s SET status = 'cancelled'
FROM public.facilities f
WHERE f.id = s.facility_id AND f.is_demo AND s.status IN ('open','in_progress');

-- 1-d. 데모 사업장 비활성 — RPC·공개 목록·초대 수락이 is_active/deleted_at 을 본다
UPDATE public.facilities
SET is_active = false, deleted_at = COALESCE(deleted_at, now())
WHERE is_demo AND (is_active OR deleted_at IS NULL);

-- 1-e. 데모 근무자 탈퇴 처리 — 지원·채팅·근태 RPC 가 deleted_at IS NULL 을 본다.
--      (개인정보 파기 크론 personal_data_retention_daily 가 deleted_at 기준 3년 뒤 익명화한다. 더 빨리 지우려면 2단계)
UPDATE public.workers
SET deleted_at = COALESCE(deleted_at, now())
WHERE (is_demo OR kakao_id LIKE 'kakao_demo_%') AND deleted_at IS NULL;

-- 1-f. 데모 로그인 계정 정지 — 세션이 끊기고 /api/demo-login 도 실패한다(삭제는 2단계)
UPDATE auth.users
SET banned_until = 'infinity'
WHERE email LIKE '%@demo.atman.co.kr' AND (banned_until IS NULL OR banned_until < now());

COMMIT;

-- 되돌리기(시연 재개): 위 UPDATE 들을 반대로 — is_active=true, deleted_at=NULL, banned_until=NULL,
--   공고는 다음 revive 가 다시 만든다. 크론은 supabase/restore_demo_crons.sql.


-- ─── 2. PURGE (선택 · 되돌릴 수 없음) ─────────────────────────────────────────
-- 실행하려면 아래 SET 을 먼저 켠다. (실수 방지)
--   SET app.confirm_demo_purge = 'yes';
DO $purge$
DECLARE
  v_ok text := current_setting('app.confirm_demo_purge', true);
BEGIN
  IF v_ok IS DISTINCT FROM 'yes' THEN
    RAISE NOTICE 'PURGE 건너뜀 — SET app.confirm_demo_purge = ''yes'' 뒤에 다시 실행';
    RETURN;
  END IF;

  -- 지울 집합
  CREATE TEMP TABLE _demo_f ON COMMIT DROP AS SELECT id FROM public.facilities WHERE is_demo;
  CREATE TEMP TABLE _demo_w ON COMMIT DROP AS
    SELECT w.id FROM public.workers w
    LEFT JOIN auth.users u ON u.id = w.auth_user_id
    WHERE w.is_demo OR w.kakao_id LIKE 'kakao_demo_%' OR u.email LIKE '%@demo.atman.co.kr';

  -- RESTRICT 로 막는 테이블부터 (facilities ← subscriptions/payment_orders/service_*/wage_payment_instructions, workers ← wage_payment_instructions)
  DELETE FROM public.wage_payment_instructions WHERE facility_id IN (SELECT id FROM _demo_f) OR worker_id IN (SELECT id FROM _demo_w);
  DELETE FROM public.service_usage_events  WHERE facility_id IN (SELECT id FROM _demo_f);
  DELETE FROM public.service_invoices      WHERE facility_id IN (SELECT id FROM _demo_f);
  DELETE FROM public.service_addon_credits WHERE facility_id IN (SELECT id FROM _demo_f);
  DELETE FROM public.payment_orders        WHERE facility_id IN (SELECT id FROM _demo_f);
  DELETE FROM public.facility_subscriptions WHERE facility_id IN (SELECT id FROM _demo_f);

  -- 근태·정산 체인 (attendances → calculations 는 FK 방향상 calculations 먼저)
  DELETE FROM public.wage_calculations WHERE shift_attendance_id IN (
    SELECT a.id FROM public.shift_attendances a
    JOIN public.shifts s ON s.id = a.shift_id
    WHERE s.facility_id IN (SELECT id FROM _demo_f) OR a.worker_id IN (SELECT id FROM _demo_w));
  DELETE FROM public.shift_attendances a USING public.shifts s
    WHERE s.id = a.shift_id AND (s.facility_id IN (SELECT id FROM _demo_f) OR a.worker_id IN (SELECT id FROM _demo_w));
  DELETE FROM public.shift_applications a USING public.shifts s
    WHERE s.id = a.shift_id AND (s.facility_id IN (SELECT id FROM _demo_f) OR a.worker_id IN (SELECT id FROM _demo_w));
  DELETE FROM public.shifts WHERE facility_id IN (SELECT id FROM _demo_f);

  -- 사업장 (나머지 24개 테이블은 CASCADE)
  DELETE FROM public.facilities WHERE id IN (SELECT id FROM _demo_f);

  -- 계정 → profiles·workers CASCADE. 계정 없는 데모 워커는 직접.
  DELETE FROM auth.users WHERE email LIKE '%@demo.atman.co.kr';
  DELETE FROM public.workers WHERE id IN (SELECT id FROM _demo_w);

  RAISE NOTICE 'PURGE 완료';
END
$purge$;

-- 확인
-- SELECT count(*) FROM public.facilities WHERE is_demo;  -- 0
-- SELECT count(*) FROM public.workers WHERE is_demo OR kakao_id LIKE 'kakao_demo_%';  -- 0
-- SELECT jobname FROM cron.job;  -- demo 잡 없음
