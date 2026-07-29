-- ============================================================================
-- P0 약국 런칭 수정 + 데모 격리 (2026-07-29 리뷰 후속)
--   ① [P0] pharmacy_staff 면허 면제 패치 재적용 — 20260728130000의 DO 블록이
--      complete_worker_onboarding을 대상으로 잘못 걸어 조용히 no-op 됐던 것을
--      원래 의도대로 update_my_worker_profile(5-param)에 적용. (전 패치와 달리
--      치환 실패 시 RAISE로 fail-loud)
--   ② [P0] 직군 변경 시 verification_status 리셋 — approved 간호사가 온보딩
--      재호출로 무검증 약사가 되는 우회 차단
--   ③④⑤ [P1] 데모 격리 — 데모 사업장 공고를 실워커 노출/지원에서 제외
--      (데모 워커 계정은 계속 보임 — 시연 유지)
--   ⑥ [P1] 리워드 첫근무 판정에서 데모 사업장 근태 제외 (파밍 차단)
-- ============================================================================

-- ① pharmacy_staff는 면허 없이 프로필 저장 가능 (update_my_worker_profile)
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.update_my_worker_profile(text,text,text,text,text[])');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'update_my_worker_profile(5-param) not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;

  patched := replace(def,
    'v_worker_role text;',
    'v_worker_role text := (SELECT role FROM public.workers WHERE id = public.current_worker_id());');
  IF patched = def THEN RAISE EXCEPTION 'patch ①-1 no-op: v_worker_role declaration not found'; END IF;
  def := patched;

  patched := replace(def,
    'IF NULLIF(trim(COALESCE(p_license_number, '''')), '''') IS NULL AND p_license_path IS NULL THEN',
    'IF COALESCE(v_worker_role, '''') <> ''pharmacy_staff'' AND NULLIF(trim(COALESCE(p_license_number, '''')), '''') IS NULL AND p_license_path IS NULL THEN');
  IF patched = def THEN RAISE EXCEPTION 'patch ①-2 no-op: license guard not found'; END IF;

  EXECUTE patched;
END $$;

-- ② 온보딩 재호출로 직군이 바뀌면 승인 상태를 pending으로 리셋
DO $$
DECLARE
  fn regprocedure;
  def text; patched text;
BEGIN
  SELECT p.oid::regprocedure INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'complete_worker_onboarding'
  ORDER BY p.oid DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'complete_worker_onboarding not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;

  patched := replace(def,
    '    verification_status = CASE
      WHEN public.workers.verification_status = ''approved'' THEN ''approved''
      ELSE EXCLUDED.verification_status
    END,',
    '    verification_status = CASE
      WHEN public.workers.role IS DISTINCT FROM EXCLUDED.role THEN ''pending''
      WHEN public.workers.verification_status = ''approved'' THEN ''approved''
      ELSE EXCLUDED.verification_status
    END,');
  IF patched = def THEN RAISE EXCEPTION 'patch ② no-op: verification_status CASE not found'; END IF;

  EXECUTE patched;
END $$;

-- ③ apply_to_shift — 실워커의 데모 사업장 공고 지원 차단
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.apply_to_shift(uuid)');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'apply_to_shift not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;

  patched := replace(def,
    'IF v_shift.required_role NOT IN (v_worker.role, ''any'') THEN
    RAISE EXCEPTION ''자격 조건이 맞지 않는 시프트예요'';
  END IF;',
    'IF v_shift.required_role NOT IN (v_worker.role, ''any'') THEN
    RAISE EXCEPTION ''자격 조건이 맞지 않는 시프트예요'';
  END IF;
  IF COALESCE((SELECT f.is_demo FROM public.facilities f WHERE f.id = v_shift.facility_id), false)
     AND NOT COALESCE(v_worker.is_demo, false) THEN
    RAISE EXCEPTION ''현재 지원할 수 없는 시프트예요'';
  END IF;');
  IF patched = def THEN RAISE EXCEPTION 'patch ③ no-op: required_role guard not found'; END IF;

  EXECUTE patched;
END $$;

-- ④ get_nearby_open_shifts_secure — 데모 공고는 데모 워커에게만 노출
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.get_nearby_open_shifts_secure(double precision,double precision,text[])');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'get_nearby_open_shifts_secure not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%is_demo%' THEN RAISE NOTICE 'patch ④ skipped: already demo-filtered'; RETURN; END IF;

  patched := replace(def,
    'AND f.is_active = true
  AND f.deleted_at IS NULL',
    'AND f.is_active = true
  AND f.deleted_at IS NULL
  AND (COALESCE(f.is_demo, false) = false OR EXISTS (
    SELECT 1 FROM public.workers dw
    WHERE dw.auth_user_id = auth.uid() AND COALESCE(dw.is_demo, false)
  ))');
  IF patched = def THEN RAISE EXCEPTION 'patch ④ no-op: facility filter not found'; END IF;

  EXECUTE patched;
END $$;

-- ⑤ get_shift_map_points_secure — 지도 좌표도 동일 격리
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.get_shift_map_points_secure(uuid[])');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'get_shift_map_points_secure not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%is_demo%' THEN RAISE NOTICE 'patch ⑤ skipped: already demo-filtered'; RETURN; END IF;

  patched := replace(def,
    'AND f.is_active = true
    AND f.deleted_at IS NULL;',
    'AND f.is_active = true
    AND f.deleted_at IS NULL
    AND (COALESCE(f.is_demo, false) = false OR COALESCE(w.is_demo, false));');
  IF patched = def THEN RAISE EXCEPTION 'patch ⑤ no-op: facility filter not found'; END IF;

  EXECUTE patched;
END $$;

-- ⑥ 리워드 첫근무 판정 — 데모 사업장 근태 제외
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.get_my_launch_reward_status()');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'get_my_launch_reward_status not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;

  patched := replace(def,
    'SELECT a.id INTO v_attendance_id FROM public.shift_attendances a
    WHERE a.worker_id=v_me.id AND a.check_out_at IS NOT NULL AND NOT COALESCE(a.has_dispute,false)
    ORDER BY a.check_out_at LIMIT 1;',
    'SELECT a.id INTO v_attendance_id FROM public.shift_attendances a
    JOIN public.shifts rs ON rs.id = a.shift_id
    JOIN public.facilities rf ON rf.id = rs.facility_id
    WHERE a.worker_id=v_me.id AND a.check_out_at IS NOT NULL AND NOT COALESCE(a.has_dispute,false)
      AND COALESCE(rf.is_demo, false) = false
    ORDER BY a.check_out_at LIMIT 1;');
  IF patched = def THEN RAISE EXCEPTION 'patch ⑥ no-op: first-shift query not found'; END IF;

  EXECUTE patched;
END $$;

-- ============================================================================
-- 검증 (전부 true여야 성공)
-- ============================================================================
SELECT
  strpos(pg_get_functiondef(to_regprocedure('public.update_my_worker_profile(text,text,text,text,text[])')), 'pharmacy_staff') > 0
    AS p1_license_exemption_applied,
  strpos(pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='complete_worker_onboarding' ORDER BY p.oid DESC LIMIT 1)::regprocedure),
    'role IS DISTINCT FROM EXCLUDED.role') > 0
    AS p2_role_change_resets_verification,
  strpos(pg_get_functiondef(to_regprocedure('public.apply_to_shift(uuid)')), 'is_demo') > 0
    AS p3_apply_demo_guard,
  strpos(pg_get_functiondef(to_regprocedure('public.get_nearby_open_shifts_secure(double precision,double precision,text[])')), 'is_demo') > 0
    AS p4_nearby_demo_filter,
  strpos(pg_get_functiondef(to_regprocedure('public.get_shift_map_points_secure(uuid[])')), 'is_demo') > 0
    AS p5_map_demo_filter,
  strpos(pg_get_functiondef(to_regprocedure('public.get_my_launch_reward_status()')), 'rf.is_demo') > 0
    AS p6_reward_demo_excluded;
