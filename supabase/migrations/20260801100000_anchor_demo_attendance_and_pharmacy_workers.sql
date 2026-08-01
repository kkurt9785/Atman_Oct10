-- Keep the two sales-demo facilities complete and easy to demonstrate.
-- Scope is intentionally limited to:
--   1. is_demo W여성병원 (first active row)
--   2. DEMO-TARGET-PHARMACY

INSERT INTO public.workers (
  kakao_id, name, phone, birth_date, role, verification_status, verified_at,
  license_number, experience_years, last_workplace, department_tags,
  last_active_at, is_demo
) VALUES
  (
    'demo_pharmacist_1', '수원 권선구 데모약사 01', '01090001001', '1992-04-12',
    'pharmacist', 'approved', now(), 'DEMO-PH-2026-01', '5년',
    '수원 온누리 데모약국', ARRAY['조제','복약지도'], now(), true
  ),
  (
    'demo_pharmacy_staff_1', '수원 권선구 데모전산 01', '01090001002', '1996-09-21',
    'pharmacy_staff', 'approved', now(), NULL, '3년',
    '수원 온누리 데모약국', ARRAY['전산','접수','재고정리'], now(), true
  )
ON CONFLICT (kakao_id) DO UPDATE SET
  name = EXCLUDED.name,
  phone = EXCLUDED.phone,
  birth_date = EXCLUDED.birth_date,
  role = EXCLUDED.role,
  verification_status = 'approved',
  verified_at = COALESCE(public.workers.verified_at, now()),
  license_number = COALESCE(public.workers.license_number, EXCLUDED.license_number),
  experience_years = EXCLUDED.experience_years,
  last_workplace = EXCLUDED.last_workplace,
  department_tags = EXCLUDED.department_tags,
  last_active_at = now(),
  deleted_at = NULL,
  is_demo = true,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.refresh_anchor_demo_showcase()
RETURNS TABLE(kind text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_hospital uuid;
  v_pharmacy uuid;
  v_pharmacist uuid;
  v_office_worker uuid;
BEGIN
  SELECT id INTO v_hospital
  FROM public.facilities
  WHERE name = 'W여성병원'
    AND is_demo = true AND is_active = true AND deleted_at IS NULL
  ORDER BY business_registration_number
  LIMIT 1;

  SELECT id INTO v_pharmacy
  FROM public.facilities
  WHERE business_registration_number = 'DEMO-TARGET-PHARMACY'
    AND is_demo = true AND is_active = true AND deleted_at IS NULL
  LIMIT 1;

  IF v_hospital IS NULL THEN
    RAISE EXCEPTION 'active demo W여성병원 not found';
  END IF;
  IF v_pharmacy IS NULL THEN
    RAISE EXCEPTION 'active DEMO-TARGET-PHARMACY not found';
  END IF;

  SELECT id INTO v_pharmacist FROM public.workers
  WHERE kakao_id = 'demo_pharmacist_1' AND is_demo = true AND deleted_at IS NULL;
  SELECT id INTO v_office_worker FROM public.workers
  WHERE kakao_id = 'demo_pharmacy_staff_1' AND is_demo = true AND deleted_at IS NULL;

  -- The approved-leave employee must also have an Attendance row so all five
  -- W여성병원 employees appear in both today's board and attendance history.
  INSERT INTO public.staff_attendances (
    facility_id, staff_id, work_date, scheduled_start, scheduled_end,
    check_in_at, check_out_at, checkout_requested_at, break_minutes,
    status, late_minutes, note
  )
  SELECT
    v_hospital, s.id, v_today, s.default_start_time, s.default_end_time,
    NULL, NULL, NULL, 0, 'leave', 0, '데모: 승인 연차'
  FROM public.facility_staff s
  WHERE s.facility_id = v_hospital
    AND s.phone LIKE 'DEMO-WF-%-5'
    AND s.status = 'active'
  ON CONFLICT (staff_id, work_date) DO UPDATE SET
    facility_id = EXCLUDED.facility_id,
    scheduled_start = EXCLUDED.scheduled_start,
    scheduled_end = EXCLUDED.scheduled_end,
    check_in_at = NULL,
    check_out_at = NULL,
    checkout_requested_at = NULL,
    break_minutes = 0,
    status = 'leave',
    late_minutes = 0,
    note = EXCLUDED.note,
    updated_at = now();

  -- Link the pharmacy's showcased employees to real demo worker profiles.
  UPDATE public.facility_staff SET
    worker_id = v_pharmacist, source = 'atman', updated_at = now()
  WHERE facility_id = v_pharmacy AND phone = 'DEMO-PHARMACY-01';

  UPDATE public.facility_staff SET
    worker_id = v_office_worker, source = 'atman', updated_at = now()
  WHERE facility_id = v_pharmacy AND phone = 'DEMO-PHARMACY-03';

  -- Show one suitable demo applicant on each open pharmacy role.
  INSERT INTO public.shift_applications (
    shift_id, worker_id, status, match_score, distance_meters, applied_at
  )
  SELECT s.id, v_pharmacist, 'applied', 96, 680, now() - interval '12 minutes'
  FROM public.shifts s
  WHERE s.facility_id = v_pharmacy AND s.status = 'open'
    AND s.required_role = 'pharmacist'
    AND v_pharmacist IS NOT NULL
  ON CONFLICT (shift_id, worker_id) DO UPDATE SET
    status = 'applied', match_score = 96, distance_meters = 680,
    applied_at = EXCLUDED.applied_at, responded_at = NULL, cancelled_at = NULL;

  INSERT INTO public.shift_applications (
    shift_id, worker_id, status, match_score, distance_meters, applied_at
  )
  SELECT s.id, v_office_worker, 'applied', 93, 920, now() - interval '6 minutes'
  FROM public.shifts s
  WHERE s.facility_id = v_pharmacy AND s.status = 'open'
    AND s.required_role = 'pharmacy_staff'
    AND v_office_worker IS NOT NULL
  ON CONFLICT (shift_id, worker_id) DO UPDATE SET
    status = 'applied', match_score = 93, distance_meters = 920,
    applied_at = EXCLUDED.applied_at, responded_at = NULL, cancelled_at = NULL;

  RETURN QUERY
  SELECT 'w_staff'::text, count(*) FROM public.facility_staff
    WHERE facility_id = v_hospital AND status = 'active'
  UNION ALL
  SELECT 'w_today_attendance', count(*) FROM public.staff_attendances
    WHERE facility_id = v_hospital AND work_date = v_today
  UNION ALL
  SELECT 'pharmacy_staff', count(*) FROM public.facility_staff
    WHERE facility_id = v_pharmacy AND status = 'active'
  UNION ALL
  SELECT 'pharmacy_today_attendance', count(*) FROM public.staff_attendances
    WHERE facility_id = v_pharmacy AND work_date = v_today
  UNION ALL
  SELECT 'pharmacy_demo_applicants', count(*)
    FROM public.shift_applications a
    JOIN public.shifts s ON s.id = a.shift_id
    JOIN public.workers w ON w.id = a.worker_id
    WHERE s.facility_id = v_pharmacy AND s.status = 'open' AND w.is_demo = true;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_anchor_demo_showcase() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_anchor_demo_showcase() TO service_role;

-- Runs after the existing W clinic (00:10) and pharmacy (00:12) refresh jobs.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'anchor-demo-showcase-daily';

SELECT cron.schedule(
  'anchor-demo-showcase-daily',
  '15 15 * * *',
  'select public.refresh_anchor_demo_showcase();'
);

SELECT * FROM public.refresh_anchor_demo_showcase();

DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_hospital uuid;
  v_pharmacy uuid;
BEGIN
  SELECT id INTO v_hospital FROM public.facilities
  WHERE name = 'W여성병원' AND is_demo = true AND is_active = true AND deleted_at IS NULL
  ORDER BY business_registration_number LIMIT 1;
  SELECT id INTO v_pharmacy FROM public.facilities
  WHERE business_registration_number = 'DEMO-TARGET-PHARMACY'
    AND is_demo = true AND is_active = true AND deleted_at IS NULL LIMIT 1;

  IF (SELECT count(*) FROM public.staff_attendances
      WHERE facility_id = v_hospital AND work_date = v_today)
     <> (SELECT count(*) FROM public.facility_staff
         WHERE facility_id = v_hospital AND status = 'active') THEN
    RAISE EXCEPTION 'W여성병원 attendance showcase is incomplete';
  END IF;

  IF (SELECT count(*) FROM public.staff_attendances
      WHERE facility_id = v_pharmacy AND work_date = v_today)
     <> (SELECT count(*) FROM public.facility_staff
         WHERE facility_id = v_pharmacy AND status = 'active') THEN
    RAISE EXCEPTION 'demo pharmacy attendance showcase is incomplete';
  END IF;
END $$;
