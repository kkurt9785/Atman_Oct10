-- Keep the selected care-hospital demo useful for monthly attendance demos.
-- The daily workforce refresh recreates facility_staff, so this runs after it.
CREATE OR REPLACE FUNCTION public.refresh_demo_care_month_history()
RETURNS TABLE(kind text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_start date := (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '1 month')::date;
  v_end date := (date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '1 day')::date;
  v_facility uuid;
BEGIN
  SELECT id INTO v_facility FROM public.facilities
  WHERE business_registration_number = 'DEMO-TARGET-0026'
    AND facility_type = 'care_hospital' AND is_demo = true
    AND is_active = true AND deleted_at IS NULL
  LIMIT 1;
  IF v_facility IS NULL THEN RAISE EXCEPTION 'care demo facility not found'; END IF;

  WITH eligible AS (
    SELECT s.*, d::date AS work_date,
      row_number() OVER (PARTITION BY s.id ORDER BY d) AS seq
    FROM public.facility_staff s
    CROSS JOIN generate_series(v_start, v_end, interval '1 day') d
    WHERE s.facility_id = v_facility AND s.phone LIKE 'DEMO-WF-%'
      AND s.status = 'active'
      AND ((s.engagement_type = 'daily' AND extract(isodow FROM d) IN (5,6))
        OR (s.engagement_type <> 'daily' AND extract(isodow FROM d) BETWEEN 1 AND 5))
  ), shaped AS (
    SELECT e.*,
      CASE WHEN engagement_type='temporary' AND seq=6 THEN 'absent'
           WHEN engagement_type='regular' AND role='na' AND seq=10 THEN 'leave'
           WHEN engagement_type='fixed_term' AND seq IN (4,14) THEN 'late'
           ELSE 'completed' END AS att_status,
      CASE WHEN engagement_type='fixed_term' AND seq IN (4,14) THEN 11 ELSE 0 END AS late_value,
      CASE WHEN engagement_type='regular' AND role='rn' AND seq=12 THEN 30 ELSE 0 END AS early_value
    FROM eligible e
  )
  INSERT INTO public.staff_attendances (
    facility_id, staff_id, work_date, scheduled_start, scheduled_end,
    check_in_at, check_out_at, break_minutes, status,
    check_in_method, check_out_method, late_minutes, early_leave_minutes, note
  )
  SELECT v_facility, id, work_date, default_start_time, default_end_time,
    CASE WHEN att_status IN ('absent','leave') THEN NULL ELSE
      ((work_date + default_start_time) AT TIME ZONE 'Asia/Seoul')
      + CASE WHEN late_value > 0 THEN late_value * interval '1 minute' ELSE interval '-3 minutes' END END,
    CASE WHEN att_status IN ('absent','leave') THEN NULL ELSE
      ((work_date + default_end_time) AT TIME ZONE 'Asia/Seoul')
      + CASE WHEN default_end_time <= default_start_time THEN interval '1 day' ELSE interval '0 day' END
      - early_value * interval '1 minute' + interval '3 minutes' END,
    CASE WHEN engagement_type='daily' THEN 0 ELSE default_break_minutes END,
    att_status,
    CASE WHEN att_status IN ('absent','leave') THEN NULL WHEN seq % 5=0 THEN 'QR_FALLBACK' ELSE 'GPS' END,
    CASE WHEN att_status IN ('absent','leave') THEN NULL WHEN seq % 5=0 THEN 'QR_FALLBACK' ELSE 'GPS' END,
    late_value, early_value,
    CASE att_status WHEN 'absent' THEN '데모 월간: 결근 확인'
      WHEN 'leave' THEN '데모 월간: 승인 휴가' WHEN 'late' THEN '데모 월간: 지각'
      ELSE CASE WHEN early_value>0 THEN '데모 월간: 조퇴' ELSE '데모 월간: 정상 근무' END END
  FROM shaped
  ON CONFLICT (staff_id, work_date) DO UPDATE SET
    scheduled_start=EXCLUDED.scheduled_start, scheduled_end=EXCLUDED.scheduled_end,
    check_in_at=EXCLUDED.check_in_at, check_out_at=EXCLUDED.check_out_at,
    break_minutes=EXCLUDED.break_minutes, status=EXCLUDED.status,
    check_in_method=EXCLUDED.check_in_method, check_out_method=EXCLUDED.check_out_method,
    late_minutes=EXCLUDED.late_minutes, early_leave_minutes=EXCLUDED.early_leave_minutes,
    note=EXCLUDED.note, updated_at=now();

  RETURN QUERY SELECT 'care_previous_month'::text, count(*)
  FROM public.staff_attendances WHERE facility_id=v_facility AND work_date BETWEEN v_start AND v_end;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_demo_care_month_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_demo_care_month_history() TO service_role;

-- All three monthly histories are restored after the 00:10/00:12 workforce jobs.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='anchor-demo-showcase-daily';
SELECT cron.schedule('anchor-demo-showcase-daily','15 15 * * *',
  'select public.refresh_anchor_demo_showcase(); select public.refresh_anchor_demo_month_history(); select public.refresh_demo_care_month_history();');

SELECT * FROM public.refresh_anchor_demo_month_history();
SELECT * FROM public.refresh_demo_care_month_history();
