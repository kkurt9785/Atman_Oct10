-- 2026-11-12 시연 근무 건 '행사장 설치·철수 (3일)'을 일급 → 시급으로.
-- 앱의 근무 만들기는 시급만 저장한다(lib/actions/gig-projects.ts pay_basis 'hourly'). 시연에서만 일급이 보이면
-- 사장님이 만들 수 없는 모양을 보여 주게 되고, 근무 건 카드도 일급을 '시급'으로 적었다.
DO $patch$
DECLARE v_def text; v_new text; v_hits int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'seed_gig_demo_projects';
  IF v_def IS NULL THEN RAISE EXCEPTION 'seed_gig_demo_projects 가 없어요 — 20261112100000 먼저'; END IF;
  IF v_def LIKE '%60, ''hourly'', 14000, 6,%' THEN RAISE NOTICE '이미 시급으로 바뀌어 있어요'; RETURN; END IF;
  v_hits := (length(v_def) - length(replace(v_def, '60, ''daily'', 130000, 6,', ''))) / length('60, ''daily'', 130000, 6,');
  IF v_hits <> 1 THEN RAISE EXCEPTION 'seed_gig_demo_projects 원문이 예상과 달라요(%곳)', v_hits; END IF;
  v_new := replace(v_def, '60, ''daily'', 130000, 6,', '60, ''hourly'', 14000, 6,');
  EXECUTE v_new;
END
$patch$;

SELECT public.seed_gig_demo_projects();
