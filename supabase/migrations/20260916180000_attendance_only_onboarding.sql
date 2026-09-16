-- 근태 전용 가입 허용 (A안)
--
-- 배경: 사업장이 보낸 초대 링크를 받은 직원이 워커 앱에서 가입하려면 알바 마켓용
-- 절차를 그대로 통과해야 했다. 세 군데가 막았다.
--   ① 직군이 간호사·간호조무사·약사·약국사무 4개뿐이라 요양보호사·조리·사무·시설직은
--      고를 게 없었다. 요양병원 전 직원 근태를 쓰려면 이게 그대로 차단이다.
--   ② 활동 지역 1~2개가 필수였다. 근무 찾기용이라 정직원에게는 물을 이유가 없다.
--   ③ 계좌가 필수였다. 급여는 사업장이 직접 지급하므로 가입 시점에 받을 이유가 없고,
--      첫 화면에서 계좌를 요구하면 그 자리에서 이탈한다.
--
-- 이 마이그레이션은 ①의 선택지를 늘리고 ②③을 선택으로 바꾼다. 기존 알바 가입 흐름은
-- 지금까지와 똑같이 지역·계좌를 채워 보내므로 동작이 달라지지 않는다.
--
-- 주의: 계좌를 건너뛴 워커는 알바 지원 후 정산 단계에서 계좌가 없어 막힌다. 그건
-- 의도한 것이다. 계좌는 돈을 받을 일이 실제로 생겼을 때 '내 정보'에서 등록한다.

-- ── ① 직군 추가 ────────────────────────────────────────────────────────────
INSERT INTO public.job_categories (code, name_ko, sector)
VALUES
  ('care_worker', '요양보호사', 'healthcare'),
  ('other', '기타 · 사업장 지정', 'healthcare')
ON CONFLICT (code) DO UPDATE
  SET name_ko = EXCLUDED.name_ko, sector = EXCLUDED.sector, is_active = true;

ALTER TABLE public.workers DROP CONSTRAINT IF EXISTS workers_role_check;
ALTER TABLE public.workers
  ADD CONSTRAINT workers_role_check
  CHECK (role IN ('rn','na','pharmacist','pharmacy_staff','care_worker','other'));

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_required_role_check;
ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_required_role_check
  CHECK (required_role IN ('rn','na','pharmacist','pharmacy_staff','care_worker','other','any'));

ALTER TABLE public.shift_templates DROP CONSTRAINT IF EXISTS shift_templates_required_role_check;
ALTER TABLE public.shift_templates
  ADD CONSTRAINT shift_templates_required_role_check
  CHECK (required_role IN ('rn','na','pharmacist','pharmacy_staff','care_worker','other','any'));

-- facility_staff 는 이미 'other' 를 받고 있었다. care_worker 만 맞춰 넣는다.
ALTER TABLE public.facility_staff DROP CONSTRAINT IF EXISTS facility_staff_role_check;
ALTER TABLE public.facility_staff
  ADD CONSTRAINT facility_staff_role_check
  CHECK (role IN ('rn','na','pharmacist','pharmacy_staff','care_worker','coordinator','admin','other'));

-- ── ②③ complete_worker_onboarding 완화 ────────────────────────────────────
-- 이 함수는 2026-07-28 마이그레이션에서 본문 문자열 치환으로 한 번 손댄 이력이 있어
-- 원본 파일이 아니라 살아 있는 정의를 받아 다시 치환한다.
DO $mig$
DECLARE
  fn regprocedure;
  def text;
  patched text;
  step text;
BEGIN
  SELECT p.oid::regprocedure INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'complete_worker_onboarding'
  ORDER BY p.oid DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'complete_worker_onboarding 함수를 찾지 못했습니다'; END IF;

  SELECT pg_get_functiondef(fn) INTO def;
  patched := def;

  -- ① 직군 검사
  IF position($p$'care_worker'$p$ in patched) = 0 THEN
    step := patched;
    patched := replace(patched,
      $p$IF p_role NOT IN ('rn','na','pharmacist','pharmacy_staff') THEN$p$,
      $p$IF p_role NOT IN ('rn','na','pharmacist','pharmacy_staff','care_worker','other') THEN$p$);
    IF patched = step THEN
      RAISE EXCEPTION '① 직군 검사 문구를 찾지 못했습니다 — 함수 본문이 예상과 다릅니다';
    END IF;
  END IF;

  -- ② 활동 지역 0개 허용
  IF position($p$NOT BETWEEN 0 AND 2$p$ in patched) = 0 THEN
    step := patched;
    patched := replace(patched,
      $p$OR jsonb_array_length(COALESCE(p_areas, '[]'::jsonb)) NOT BETWEEN 1 AND 2 THEN$p$,
      $p$OR jsonb_array_length(COALESCE(p_areas, '[]'::jsonb)) NOT BETWEEN 0 AND 2 THEN$p$);
    IF patched = step THEN
      RAISE EXCEPTION '② 활동 지역 개수 검사 문구를 찾지 못했습니다';
    END IF;
    patched := replace(patched,
      $p$RAISE EXCEPTION '활동 지역을 1~2개 선택해 주세요';$p$,
      $p$RAISE EXCEPTION '활동 지역은 최대 2개까지 선택할 수 있어요';$p$);
  END IF;

  -- ③ 계좌 미입력 허용
  IF position($p$IF NULLIF(trim(COALESCE(p_bank_code, '')), '') IS NOT NULL THEN$p$ in patched) = 0 THEN
    step := patched;
    patched := replace(patched,
$p$  PERFORM public.upsert_my_bank_account(
    p_bank_code, p_bank_name, p_account_number,
    COALESCE(NULLIF(trim(p_account_holder_name), ''), trim(p_name))
  );$p$,
$p$  IF NULLIF(trim(COALESCE(p_bank_code, '')), '') IS NOT NULL THEN
    PERFORM public.upsert_my_bank_account(
      p_bank_code, p_bank_name, p_account_number,
      COALESCE(NULLIF(trim(p_account_holder_name), ''), trim(p_name))
    );
  END IF;$p$);
    IF patched = step THEN
      RAISE EXCEPTION '③ 계좌 등록 호출부를 찾지 못했습니다';
    END IF;
  END IF;

  IF patched = def THEN
    RAISE NOTICE 'complete_worker_onboarding: 이미 적용돼 있어 건너뜁니다';
  ELSE
    EXECUTE patched;
  END IF;
END $mig$;

-- ── 검증 ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  fn regprocedure;
  def text;
BEGIN
  SELECT p.oid::regprocedure INTO fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'complete_worker_onboarding'
  ORDER BY p.oid DESC LIMIT 1;
  SELECT pg_get_functiondef(fn) INTO def;

  IF position($p$'care_worker'$p$ in def) = 0 THEN
    RAISE EXCEPTION '검증 실패: 직군 목록에 care_worker 가 없습니다';
  END IF;
  IF position($p$NOT BETWEEN 0 AND 2$p$ in def) = 0 THEN
    RAISE EXCEPTION '검증 실패: 활동 지역 0개가 허용되지 않았습니다';
  END IF;
  IF position($p$IF NULLIF(trim(COALESCE(p_bank_code, '')), '') IS NOT NULL THEN$p$ in def) = 0 THEN
    RAISE EXCEPTION '검증 실패: 계좌가 여전히 필수입니다';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workers_role_check'
      AND pg_get_constraintdef(oid) LIKE '%care_worker%'
  ) THEN
    RAISE EXCEPTION '검증 실패: workers_role_check 에 care_worker 가 없습니다';
  END IF;
END $verify$;
