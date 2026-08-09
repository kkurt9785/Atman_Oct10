-- ============================================================================
-- demo-2 약국직원 링크가 야간 cron에서 풀리던 문제 수정 (2026-08-05)
-- 원인: refresh_demo_pharmacy_workforce의 demo-2 조회가 auth.users 조인이라
--   cron 실행 컨텍스트에서 빈 값 반환 → 박하늘 worker_id NULL/타계정 회귀.
--   (김서현은 public.workers만 조회라 정상 유지 — 패턴 일치)
-- 수정: ①public.workers.kakao_id('demo_pharmacy_staff_2')로 조회 (auth 조인 제거)
--       ②함수 마지막에 링크 강제 UPDATE (다른 시드가 끼어들어도 최종 승리)
-- ============================================================================

DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.refresh_demo_pharmacy_workforce()');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'refresh_demo_pharmacy_workforce not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;

  patched := replace(def,
    'SELECT w.id INTO v_staff_worker
  FROM public.workers w
  JOIN auth.users u ON u.id = w.auth_user_id
  WHERE u.email = ''worker-demo-2@demo.atman.co.kr'' AND w.deleted_at IS NULL;',
    'SELECT id INTO v_staff_worker FROM public.workers
  WHERE is_demo = true AND kakao_id = ''demo_pharmacy_staff_2'' AND deleted_at IS NULL;');
  -- 이미 후속 마이그레이션에서 public.workers 조회로 바뀐 환경도 허용한다.
  IF patched <> def THEN def := patched; END IF;

  patched := replace(def,
    '  RETURN QUERY
  SELECT ''pharmacy_staff''::text, count(*) FROM public.facility_staff',
    '  -- 링크 최종 강제 — 어떤 경로로 끊겨도 이 함수가 마지막에 복원한다
  IF v_staff_worker IS NOT NULL THEN
    UPDATE public.facility_staff SET worker_id = v_staff_worker
    WHERE facility_id = v_ph AND phone = ''DEMO-PHARMACY-03''
      AND worker_id IS DISTINCT FROM v_staff_worker;
  END IF;
  IF v_worker IS NOT NULL THEN
    UPDATE public.facility_staff SET worker_id = v_worker
    WHERE facility_id = v_ph AND phone = ''DEMO-PHARMACY-01''
      AND worker_id IS DISTINCT FROM v_worker;
  END IF;

  RETURN QUERY
  SELECT ''pharmacy_staff''::text, count(*) FROM public.facility_staff');
  -- 링크 강제 구문도 이미 들어간 환경이면 현재 함수 정의를 그대로 유지한다.
  IF patched <> def THEN EXECUTE patched; END IF;
END $$;

-- 즉시 1회 실행 — linked_accounts = 2 확인
SELECT * FROM public.refresh_demo_pharmacy_workforce();

-- 진단: 데모 관련 cron 전체 목록 (경쟁 시드 잡이 있는지 눈으로 확인)
SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;
