-- ============================================================================
-- 단계적 자격검증을 약사까지 확대 (2026-08-18)
--
-- 근거: 잇닿은 직업정보제공사업자이지 자격 심사기관이 아니다. 약사를 채용하는
-- 약국은 당연히 면허를 직접 확인하며, 플랫폼이 사전 심사를 대신할수록 오히려
-- 직업소개업 성격이 짙어진다. 간호직과 동일하게 "탐색·지원은 자유, 채용 확정
-- 전 사업장이 자격 확인"으로 통일한다.
--
-- 적용 후 직군별 구조:
--   rn/na/pharmacist  : 서류 선택, 사업장이 확정 전 확인(pending_facility_check)
--   pharmacy_staff    : 이력서 제출 → 자동 승인 트리거(기존 유지)
-- ============================================================================

-- ① 지원 시 자격검토 상태를 부여하는 트리거
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.set_application_credential_review_status()'::regprocedure) INTO def;
  IF def LIKE '%''rn'', ''na'', ''pharmacist''%' THEN RAISE NOTICE '① already extended'; RETURN; END IF;
  patched := replace(def, 'v_worker.role IN (''rn'', ''na'')', 'v_worker.role IN (''rn'', ''na'', ''pharmacist'')');
  IF patched = def THEN RAISE EXCEPTION 'trigger role anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ② 사업장 자격확인 RPC 대상 직군
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.confirm_application_credential(uuid)'::regprocedure) INTO def;
  IF def LIKE '%''rn'', ''na'', ''pharmacist''%' THEN RAISE NOTICE '② already extended'; RETURN; END IF;
  patched := replace(def, 'IF v_role NOT IN (''rn'', ''na'') THEN', 'IF v_role NOT IN (''rn'', ''na'', ''pharmacist'') THEN');
  IF patched = def THEN RAISE EXCEPTION 'confirm role anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ③ 공고 탐색
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.get_nearby_open_shifts_secure(double precision,double precision,text[])'::regprocedure) INTO def;
  IF def LIKE '%''rn'', ''na'', ''pharmacist''%' THEN RAISE NOTICE '③ already extended'; RETURN; END IF;
  patched := replace(def, 'w.role IN (''rn'', ''na'')', 'w.role IN (''rn'', ''na'', ''pharmacist'')');
  IF patched = def THEN RAISE EXCEPTION 'discovery role anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ④ 매칭 알림 수신 대상
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.get_shift_notification_recipients(uuid)'::regprocedure) INTO def;
  IF def LIKE '%''rn'', ''na'', ''pharmacist''%' THEN RAISE NOTICE '④ already extended'; RETURN; END IF;
  patched := replace(def, 'w.role IN (''rn'', ''na'')', 'w.role IN (''rn'', ''na'', ''pharmacist'')');
  IF patched = def THEN RAISE EXCEPTION 'notification role anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ⑤ 지원 게이트
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.apply_to_shift(uuid)'::regprocedure) INTO def;
  IF def LIKE '%''rn'', ''na'', ''pharmacist''%' THEN RAISE NOTICE '⑤ already extended'; RETURN; END IF;
  patched := replace(def, 'v_worker.role NOT IN (''rn'', ''na'')', 'v_worker.role NOT IN (''rn'', ''na'', ''pharmacist'')');
  IF patched = def THEN RAISE EXCEPTION 'apply role anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ⑥ 채용 확정 게이트 (사업장 확인이 있으면 통과)
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.accept_shift_application(uuid)'::regprocedure) INTO def;
  IF def LIKE '%''rn'', ''na'', ''pharmacist''%' THEN RAISE NOTICE '⑥ already extended'; RETURN; END IF;
  patched := replace(def, 'v_worker.role IN (''rn'', ''na'')', 'v_worker.role IN (''rn'', ''na'', ''pharmacist'')');
  IF patched = def THEN RAISE EXCEPTION 'accept role anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ⑦ 프로필 저장 시 면허 강제 해제 (약사도 나중에 등록 가능)
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.update_my_worker_profile(text,text,text,text,text[])'::regprocedure) INTO def;
  IF def LIKE '%''pharmacy_staff'', ''rn'', ''na'', ''pharmacist''%' THEN RAISE NOTICE '⑦ already extended'; RETURN; END IF;
  patched := replace(def,
    'NOT IN (''pharmacy_staff'', ''rn'', ''na'')',
    'NOT IN (''pharmacy_staff'', ''rn'', ''na'', ''pharmacist'')');
  IF patched = def THEN RAISE EXCEPTION 'profile license anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- ⑧ 런칭 리워드 프로필 마일스톤
DO $$
DECLARE def text; patched text;
BEGIN
  SELECT pg_get_functiondef('public.get_my_launch_reward_status()'::regprocedure) INTO def;
  IF def LIKE '%''rn'',''na'',''pharmacist''%' THEN RAISE NOTICE '⑧ already extended'; RETURN; END IF;
  patched := replace(def, 'v_me.role IN (''rn'',''na'')', 'v_me.role IN (''rn'',''na'',''pharmacist'')');
  IF patched = def THEN RAISE EXCEPTION 'reward role anchor not found'; END IF;
  EXECUTE patched;
END $$;

-- 검증 (8개 모두 true면 성공)
SELECT
  strpos(pg_get_functiondef('public.set_application_credential_review_status()'::regprocedure), '''rn'', ''na'', ''pharmacist''') > 0 AS trigger_ok,
  strpos(pg_get_functiondef('public.confirm_application_credential(uuid)'::regprocedure), '''rn'', ''na'', ''pharmacist''') > 0 AS confirm_ok,
  strpos(pg_get_functiondef('public.get_nearby_open_shifts_secure(double precision,double precision,text[])'::regprocedure), '''rn'', ''na'', ''pharmacist''') > 0 AS discovery_ok,
  strpos(pg_get_functiondef('public.get_shift_notification_recipients(uuid)'::regprocedure), '''rn'', ''na'', ''pharmacist''') > 0 AS notify_ok,
  strpos(pg_get_functiondef('public.apply_to_shift(uuid)'::regprocedure), '''rn'', ''na'', ''pharmacist''') > 0 AS apply_ok,
  strpos(pg_get_functiondef('public.accept_shift_application(uuid)'::regprocedure), '''rn'', ''na'', ''pharmacist''') > 0 AS accept_ok,
  strpos(pg_get_functiondef('public.update_my_worker_profile(text,text,text,text,text[])'::regprocedure), '''pharmacy_staff'', ''rn'', ''na'', ''pharmacist''') > 0 AS profile_ok,
  strpos(pg_get_functiondef('public.get_my_launch_reward_status()'::regprocedure), '''rn'',''na'',''pharmacist''') > 0 AS reward_ok;
