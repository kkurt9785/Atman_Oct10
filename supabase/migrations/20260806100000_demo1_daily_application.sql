-- ============================================================================
-- demo-1(W여성병원 간호사) 매일 지원 상태 보장 (2026-08-06)
-- 병원 showcase cron(00:05 KST)이 시프트·지원을 재생성해 demo-1 지원이
-- 사라지므로, 매일 09:00 KST에 W여성병원 open 공고 1건에 demo-1을
-- 지원(applied) 상태로 시드한다 → 관리자 시연에서 항상 지원자로 보임.
-- (약국 쪽 demo-2 지원은 00:12 리프레시가 이미 보장)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_demo1_wf_application()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker uuid;
  v_facility uuid;
  v_shift uuid;
BEGIN
  SELECT id INTO v_worker FROM public.workers
  WHERE is_demo = true AND kakao_id = 'kakao_demo_gwangju_gwangsan_02' AND deleted_at IS NULL;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'demo-1 worker not found'; END IF;

  SELECT id INTO v_facility FROM public.facilities
  WHERE is_demo = true AND name LIKE 'W여성%' AND is_active = true AND deleted_at IS NULL
  LIMIT 1;
  IF v_facility IS NULL THEN RAISE EXCEPTION 'W여성병원 demo facility not found'; END IF;

  -- 이미 이 병원 open 공고에 지원 중이면 그대로 둔다
  IF EXISTS (
    SELECT 1 FROM public.shift_applications a
    JOIN public.shifts s ON s.id = a.shift_id
    WHERE a.worker_id = v_worker AND a.status = 'applied'
      AND s.facility_id = v_facility AND s.status = 'open'
  ) THEN RETURN 'already applied'; END IF;

  -- 오늘 이후 open 공고 중 demo-1 직군(rn)이 지원 가능한 가장 이른 것
  SELECT s.id INTO v_shift FROM public.shifts s
  WHERE s.facility_id = v_facility AND s.status = 'open'
    AND s.required_role IN ('rn', 'any')
    AND s.shift_date >= (now() AT TIME ZONE 'Asia/Seoul')::date
    AND NOT EXISTS (
      SELECT 1 FROM public.shift_applications a
      WHERE a.shift_id = s.id AND a.worker_id = v_worker
        AND a.status IN ('accepted', 'completed')
    )
  ORDER BY s.shift_date, s.start_time
  LIMIT 1;
  IF v_shift IS NULL THEN RETURN 'no eligible shift'; END IF;

  INSERT INTO public.shift_applications (shift_id, worker_id, status)
  VALUES (v_shift, v_worker, 'applied')
  ON CONFLICT (shift_id, worker_id) DO UPDATE
    SET status = 'applied', applied_at = now()
    WHERE public.shift_applications.status NOT IN ('accepted', 'completed');

  RETURN 'seeded';
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_demo1_wf_application() FROM PUBLIC, anon, authenticated;

-- 매일 09:00 KST (= 00:00 UTC)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demo1-wf-application-daily';
SELECT cron.schedule('demo1-wf-application-daily', '0 0 * * *',
  'SELECT public.ensure_demo1_wf_application();');

-- 즉시 1회 실행 + 검증 ('seeded' 또는 'already applied' + cron true 면 성공)
SELECT public.ensure_demo1_wf_application() AS run_result,
       EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'demo1-wf-application-daily' AND active) AS cron_registered;
