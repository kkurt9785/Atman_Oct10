-- W여성병원 3시간 데모 공고는 RN 공고이므로 RN 데모 워커만 지원자로 노출한다.
-- 실제 수락 단계의 직군 검증과 별개로, 시연 목록 자체도 일관되게 유지한다.
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.refresh_w_womens_three_hour_shift()');
  def text;
  patched text;
BEGIN
  IF fn IS NULL THEN
    RAISE EXCEPTION 'refresh_w_womens_three_hour_shift not found';
  END IF;

  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%AND w.role = ''rn''%' THEN
    RAISE NOTICE 'W demo applicant role filter already applied';
    RETURN;
  END IF;

  patched := replace(
    def,
    'WHERE w.is_demo = true
      AND w.verification_status = ''approved''',
    'WHERE w.is_demo = true
      AND w.role = ''rn''
      AND w.verification_status = ''approved'''
  );

  IF patched = def THEN
    RAISE EXCEPTION 'W demo applicant role filter patch did not match function body';
  END IF;

  EXECUTE patched;
END $$;

SELECT public.refresh_w_womens_three_hour_shift();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.shift_applications a
    JOIN public.shifts s ON s.id = a.shift_id
    JOIN public.facilities f ON f.id = s.facility_id
    JOIN public.workers w ON w.id = a.worker_id
    WHERE f.name = 'W여성병원'
      AND f.is_demo = true
      AND s.status = 'open'
      AND s.notes LIKE 'DEMO-W-SHIFT-3H-%'
      AND w.role <> s.required_role
  ) THEN
    RAISE EXCEPTION 'W demo open shift still contains a role-mismatched applicant';
  END IF;
END $$;
