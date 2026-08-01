-- A realistic previous-calendar-month attendance history for the two anchor demos.
-- The current day remains owned by the daily showcase refresh.

CREATE OR REPLACE FUNCTION public.refresh_anchor_demo_month_history()
RETURNS TABLE(kind text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_month_start date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) - interval '1 month')::date;
  v_month_end date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) - interval '1 day')::date;
  v_hospital uuid;
  v_pharmacy uuid;
BEGIN
  SELECT id INTO v_hospital FROM public.facilities
  WHERE name = 'W여성병원' AND is_demo = true AND is_active = true AND deleted_at IS NULL
  ORDER BY business_registration_number LIMIT 1;
  SELECT id INTO v_pharmacy FROM public.facilities
  WHERE business_registration_number = 'DEMO-TARGET-PHARMACY'
    AND is_demo = true AND is_active = true AND deleted_at IS NULL LIMIT 1;

  IF v_hospital IS NULL OR v_pharmacy IS NULL THEN
    RAISE EXCEPTION 'anchor demo facilities not found';
  END IF;

  -- W여성병원: 주간 직원은 평일, 야간 단기직은 금·토 근무.
  WITH eligible AS (
    SELECT s.*, d::date AS work_date,
      row_number() OVER (PARTITION BY s.id ORDER BY d) AS work_seq
    FROM public.facility_staff s
    CROSS JOIN generate_series(v_month_start, v_month_end, interval '1 day') d
    WHERE s.facility_id = v_hospital
      AND s.phone LIKE 'DEMO-WF-%'
      AND s.status = 'active'
      AND (
        (s.phone LIKE '%-5' AND extract(isodow FROM d) IN (5, 6))
        OR (s.phone NOT LIKE '%-5' AND extract(isodow FROM d) BETWEEN 1 AND 5)
      )
  ), shaped AS (
    SELECT e.*,
      CASE
        WHEN e.phone LIKE '%-4' AND e.work_seq = 7 THEN 'absent'
        WHEN e.phone LIKE '%-2' AND e.work_seq = 9 THEN 'leave'
        WHEN e.phone LIKE '%-3' AND e.work_seq IN (4, 14) THEN 'late'
        ELSE 'completed'
      END AS attendance_status,
      CASE WHEN e.phone LIKE '%-3' AND e.work_seq IN (4, 14) THEN 12 ELSE 0 END AS late_value,
      CASE WHEN e.phone LIKE '%-1' AND e.work_seq = 12 THEN 35 ELSE 0 END AS early_value
    FROM eligible e
  )
  INSERT INTO public.staff_attendances (
    facility_id, staff_id, work_date, scheduled_start, scheduled_end,
    check_in_at, check_out_at, break_minutes, status,
    check_in_method, check_out_method, late_minutes, early_leave_minutes, note
  )
  SELECT
    v_hospital, id, work_date, default_start_time, default_end_time,
    CASE WHEN attendance_status IN ('absent','leave') THEN NULL ELSE
      ((work_date + default_start_time) AT TIME ZONE 'Asia/Seoul')
      + CASE WHEN late_value > 0 THEN late_value * interval '1 minute' ELSE interval '-3 minutes' END
    END,
    CASE WHEN attendance_status IN ('absent','leave') THEN NULL ELSE
      ((work_date + default_end_time) AT TIME ZONE 'Asia/Seoul')
      + CASE WHEN default_end_time <= default_start_time THEN interval '1 day' ELSE interval '0 day' END
      - early_value * interval '1 minute' + interval '4 minutes'
    END,
    CASE WHEN phone LIKE '%-5' THEN 0 ELSE default_break_minutes END,
    attendance_status,
    CASE WHEN attendance_status IN ('absent','leave') THEN NULL WHEN work_seq % 6 = 0 THEN 'QR_FALLBACK' ELSE 'GPS' END,
    CASE WHEN attendance_status IN ('absent','leave') THEN NULL WHEN work_seq % 6 = 0 THEN 'QR_FALLBACK' ELSE 'GPS' END,
    late_value, early_value,
    CASE attendance_status
      WHEN 'absent' THEN '데모 월간: 결근 확인'
      WHEN 'leave' THEN '데모 월간: 승인 휴가'
      WHEN 'late' THEN '데모 월간: 지각'
      ELSE CASE WHEN early_value > 0 THEN '데모 월간: 조퇴' ELSE '데모 월간: 정상 근무' END
    END
  FROM shaped
  ON CONFLICT (staff_id, work_date) DO UPDATE SET
    scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
    check_in_at = EXCLUDED.check_in_at, check_out_at = EXCLUDED.check_out_at,
    break_minutes = EXCLUDED.break_minutes, status = EXCLUDED.status,
    check_in_method = EXCLUDED.check_in_method, check_out_method = EXCLUDED.check_out_method,
    late_minutes = EXCLUDED.late_minutes, early_leave_minutes = EXCLUDED.early_leave_minutes,
    note = EXCLUDED.note, updated_at = now();

  -- 수원 약국: 상시 약사·전산직은 평일, 대체약사는 토요일 근무.
  WITH eligible AS (
    SELECT s.*, d::date AS work_date,
      row_number() OVER (PARTITION BY s.id ORDER BY d) AS work_seq
    FROM public.facility_staff s
    CROSS JOIN generate_series(v_month_start, v_month_end, interval '1 day') d
    WHERE s.facility_id = v_pharmacy
      AND s.phone LIKE 'DEMO-PHARMACY-%'
      AND s.status = 'active'
      AND (
        (s.phone LIKE '%-02' AND extract(isodow FROM d) = 6)
        OR (s.phone NOT LIKE '%-02' AND extract(isodow FROM d) BETWEEN 1 AND 5)
      )
  ), shaped AS (
    SELECT e.*,
      CASE
        WHEN e.phone LIKE '%-03' AND e.work_seq = 8 THEN 'absent'
        WHEN e.phone LIKE '%-01' AND e.work_seq = 11 THEN 'leave'
        WHEN e.phone LIKE '%-03' AND e.work_seq IN (3, 15) THEN 'late'
        ELSE 'completed'
      END AS attendance_status,
      CASE WHEN e.phone LIKE '%-03' AND e.work_seq IN (3, 15) THEN 9 ELSE 0 END AS late_value,
      CASE WHEN e.phone LIKE '%-02' AND e.work_seq = 3 THEN 20 ELSE 0 END AS early_value
    FROM eligible e
  )
  INSERT INTO public.staff_attendances (
    facility_id, staff_id, work_date, scheduled_start, scheduled_end,
    check_in_at, check_out_at, break_minutes, status,
    check_in_method, check_out_method, late_minutes, early_leave_minutes, note
  )
  SELECT
    v_pharmacy, id, work_date, default_start_time, default_end_time,
    CASE WHEN attendance_status IN ('absent','leave') THEN NULL ELSE
      ((work_date + default_start_time) AT TIME ZONE 'Asia/Seoul')
      + CASE WHEN late_value > 0 THEN late_value * interval '1 minute' ELSE interval '-4 minutes' END
    END,
    CASE WHEN attendance_status IN ('absent','leave') THEN NULL ELSE
      ((work_date + default_end_time) AT TIME ZONE 'Asia/Seoul')
      - early_value * interval '1 minute' + interval '2 minutes'
    END,
    default_break_minutes, attendance_status,
    CASE WHEN attendance_status IN ('absent','leave') THEN NULL WHEN work_seq % 5 = 0 THEN 'QR_FALLBACK' ELSE 'GPS' END,
    CASE WHEN attendance_status IN ('absent','leave') THEN NULL WHEN work_seq % 5 = 0 THEN 'QR_FALLBACK' ELSE 'GPS' END,
    late_value, early_value,
    CASE attendance_status
      WHEN 'absent' THEN '데모 월간: 결근 확인'
      WHEN 'leave' THEN '데모 월간: 승인 휴가'
      WHEN 'late' THEN '데모 월간: 지각'
      ELSE CASE WHEN early_value > 0 THEN '데모 월간: 조퇴' ELSE '데모 월간: 정상 근무' END
    END
  FROM shaped
  ON CONFLICT (staff_id, work_date) DO UPDATE SET
    scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
    check_in_at = EXCLUDED.check_in_at, check_out_at = EXCLUDED.check_out_at,
    break_minutes = EXCLUDED.break_minutes, status = EXCLUDED.status,
    check_in_method = EXCLUDED.check_in_method, check_out_method = EXCLUDED.check_out_method,
    late_minutes = EXCLUDED.late_minutes, early_leave_minutes = EXCLUDED.early_leave_minutes,
    note = EXCLUDED.note, updated_at = now();

  RETURN QUERY
  SELECT 'w_previous_month'::text, count(*) FROM public.staff_attendances
    WHERE facility_id = v_hospital AND work_date BETWEEN v_month_start AND v_month_end
  UNION ALL
  SELECT 'pharmacy_previous_month', count(*) FROM public.staff_attendances
    WHERE facility_id = v_pharmacy AND work_date BETWEEN v_month_start AND v_month_end;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_anchor_demo_month_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_anchor_demo_month_history() TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'anchor-demo-showcase-daily';
SELECT cron.schedule(
  'anchor-demo-showcase-daily',
  '15 15 * * *',
  'select public.refresh_anchor_demo_showcase(); select public.refresh_anchor_demo_month_history();'
);

SELECT * FROM public.refresh_anchor_demo_month_history();

DO $$
DECLARE
  v_start date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) - interval '1 month')::date;
  v_end date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')) - interval '1 day')::date;
  v_hospital uuid;
  v_pharmacy uuid;
BEGIN
  SELECT id INTO v_hospital FROM public.facilities
  WHERE name = 'W여성병원' AND is_demo = true AND is_active = true AND deleted_at IS NULL
  ORDER BY business_registration_number LIMIT 1;
  SELECT id INTO v_pharmacy FROM public.facilities
  WHERE business_registration_number = 'DEMO-TARGET-PHARMACY'
    AND is_demo = true AND is_active = true AND deleted_at IS NULL LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM public.staff_attendances WHERE facility_id = v_hospital AND work_date BETWEEN v_start AND v_end AND status = 'absent')
    OR NOT EXISTS (SELECT 1 FROM public.staff_attendances WHERE facility_id = v_hospital AND work_date BETWEEN v_start AND v_end AND status = 'leave')
    OR NOT EXISTS (SELECT 1 FROM public.staff_attendances WHERE facility_id = v_hospital AND work_date BETWEEN v_start AND v_end AND late_minutes > 0)
    OR NOT EXISTS (SELECT 1 FROM public.staff_attendances WHERE facility_id = v_hospital AND work_date BETWEEN v_start AND v_end AND early_leave_minutes > 0)
  THEN RAISE EXCEPTION 'W여성병원 monthly demo scenarios are incomplete'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.staff_attendances WHERE facility_id = v_pharmacy AND work_date BETWEEN v_start AND v_end AND status = 'absent')
    OR NOT EXISTS (SELECT 1 FROM public.staff_attendances WHERE facility_id = v_pharmacy AND work_date BETWEEN v_start AND v_end AND status = 'leave')
    OR NOT EXISTS (SELECT 1 FROM public.staff_attendances WHERE facility_id = v_pharmacy AND work_date BETWEEN v_start AND v_end AND late_minutes > 0)
    OR NOT EXISTS (SELECT 1 FROM public.staff_attendances WHERE facility_id = v_pharmacy AND work_date BETWEEN v_start AND v_end AND early_leave_minutes > 0)
  THEN RAISE EXCEPTION 'demo pharmacy monthly scenarios are incomplete'; END IF;
END $$;
