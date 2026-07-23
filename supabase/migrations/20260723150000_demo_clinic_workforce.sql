-- Repeatable workforce-management showcase for every sales demo facility.
CREATE OR REPLACE FUNCTION public.refresh_demo_clinic_workforce()
RETURNS TABLE(kind text, count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  DELETE FROM public.facility_staff
  WHERE phone LIKE 'DEMO-WF-%'
    AND facility_id IN (
      SELECT id FROM public.facilities
      WHERE is_demo = true AND business_registration_number LIKE 'DEMO-TARGET-%'
    );

  WITH ranked_facilities AS (
    SELECT id, row_number() OVER (ORDER BY business_registration_number) AS rn
    FROM public.facilities
    WHERE is_demo = true
      AND business_registration_number LIKE 'DEMO-TARGET-%'
      AND is_active = true
      AND deleted_at IS NULL
  ),
  ranked_workers AS (
    SELECT id, row_number() OVER (ORDER BY kakao_id) AS rn
    FROM public.workers
    WHERE is_demo = true AND kakao_id LIKE 'kakao_demo_%' AND deleted_at IS NULL
  ),
  worker_count AS (
    SELECT count(*)::integer AS value FROM ranked_workers
  ),
  templates(slot_no, name, role, department, engagement_type, default_start, default_end) AS (
    VALUES
      (1, '김지영', 'rn', '외래', 'regular', '09:00'::time, '18:00'::time),
      (2, '박서윤', 'na', '처치실', 'regular', '09:00'::time, '18:00'::time),
      (3, '이민준', 'rn', '병동', 'fixed_term', '08:00'::time, '17:00'::time),
      (4, '최하은', 'na', '검진센터', 'temporary', '10:00'::time, '19:00'::time),
      (5, '정도윤', 'rn', '야간병동', 'daily', '22:00'::time, '06:00'::time)
  )
  INSERT INTO public.facility_staff (
    facility_id, worker_id, name, phone, role, department, source,
    engagement_type, contract_start, contract_end, default_start_time,
    default_end_time, default_break_minutes, status
  )
  SELECT
    f.id,
    CASE WHEN t.slot_no = 1 THEN w.id ELSE NULL END,
    t.name || ' (데모)',
    'DEMO-WF-' || lpad(f.rn::text, 4, '0') || '-' || t.slot_no,
    t.role, t.department,
    CASE WHEN t.slot_no = 1 THEN 'atman' ELSE 'imported' END,
    t.engagement_type,
    CASE WHEN t.engagement_type <> 'regular' THEN v_today - 30 ELSE NULL END,
    CASE WHEN t.engagement_type <> 'regular' THEN v_today + 60 ELSE NULL END,
    t.default_start, t.default_end, 60, 'active'
  FROM ranked_facilities f
  CROSS JOIN templates t
  CROSS JOIN worker_count wc
  LEFT JOIN ranked_workers w
    ON t.slot_no = 1 AND w.rn = ((f.rn - 1) % GREATEST(wc.value, 1)) + 1;

  INSERT INTO public.staff_leave_balances (
    facility_id, staff_id, leave_year, granted_minutes, used_minutes, note
  )
  SELECT
    facility_id, id, extract(year from v_today)::integer, 7200,
    CASE WHEN name LIKE '정도윤%' THEN 1440 ELSE 960 END,
    '데모용 연차 15일 부여'
  FROM public.facility_staff
  WHERE phone LIKE 'DEMO-WF-%'
  ON CONFLICT (staff_id, leave_year) DO UPDATE SET
    granted_minutes = EXCLUDED.granted_minutes,
    used_minutes = EXCLUDED.used_minutes,
    note = EXCLUDED.note,
    updated_at = now();

  INSERT INTO public.staff_attendances (
    facility_id, staff_id, work_date, scheduled_start, scheduled_end,
    check_in_at, check_out_at, checkout_requested_at, break_minutes,
    status, note
  )
  SELECT
    facility_id, id, v_today, default_start_time, default_end_time,
    CASE
      WHEN phone LIKE '%-1' THEN now() - interval '2 hours'
      WHEN phone LIKE '%-2' THEN now() - interval '9 hours'
      WHEN phone LIKE '%-3' THEN now() - interval '1 hour'
      WHEN phone LIKE '%-4' THEN now() - interval '4 hours'
    END,
    CASE WHEN phone LIKE '%-2' THEN now() - interval '1 hour' END,
    CASE WHEN phone LIKE '%-4' THEN now() - interval '10 minutes' END,
    60,
    CASE
      WHEN phone LIKE '%-1' THEN 'working'
      WHEN phone LIKE '%-2' THEN 'completed'
      WHEN phone LIKE '%-3' THEN 'late'
      WHEN phone LIKE '%-4' THEN 'checkout_pending'
    END,
    CASE
      WHEN phone LIKE '%-1' THEN '데모: 정상 근무 중'
      WHEN phone LIKE '%-2' THEN '데모: 퇴근 완료'
      WHEN phone LIKE '%-3' THEN '데모: 지각 확인 필요'
      WHEN phone LIKE '%-4' THEN '데모: 조기퇴근 승인 대기'
    END
  FROM public.facility_staff
  WHERE phone LIKE 'DEMO-WF-%' AND phone NOT LIKE '%-5'
  ON CONFLICT (staff_id, work_date) DO UPDATE SET
    scheduled_start = EXCLUDED.scheduled_start,
    scheduled_end = EXCLUDED.scheduled_end,
    check_in_at = EXCLUDED.check_in_at,
    check_out_at = EXCLUDED.check_out_at,
    checkout_requested_at = EXCLUDED.checkout_requested_at,
    break_minutes = EXCLUDED.break_minutes,
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    updated_at = now();

  INSERT INTO public.staff_leave_requests (
    facility_id, staff_id, leave_type, start_date, end_date,
    requested_minutes, reason, status, decided_at
  )
  SELECT
    facility_id, id, 'annual', v_today, v_today, 480,
    '데모: 개인 일정', 'approved', now() - interval '1 day'
  FROM public.facility_staff WHERE phone LIKE 'DEMO-WF-%-5';

  INSERT INTO public.staff_leave_requests (
    facility_id, staff_id, leave_type, start_date, end_date,
    requested_minutes, reason, status
  )
  SELECT
    facility_id, id, 'half_day', v_today + 1, v_today + 1, 240,
    '데모: 오후 병원 방문', 'pending'
  FROM public.facility_staff WHERE phone LIKE 'DEMO-WF-%-1';

  INSERT INTO public.facility_attendance_qr (facility_id, is_active)
  SELECT id, true
  FROM public.facilities
  WHERE is_demo = true AND business_registration_number LIKE 'DEMO-TARGET-%'
  ON CONFLICT (facility_id) DO UPDATE SET is_active = true;

  RETURN QUERY
  SELECT 'demo_staff', count(*) FROM public.facility_staff WHERE phone LIKE 'DEMO-WF-%'
  UNION ALL
  SELECT 'today_attendance', count(*) FROM public.staff_attendances a
    JOIN public.facility_staff s ON s.id = a.staff_id
    WHERE s.phone LIKE 'DEMO-WF-%' AND a.work_date = v_today
  UNION ALL
  SELECT 'pending_leave', count(*) FROM public.staff_leave_requests r
    JOIN public.facility_staff s ON s.id = r.staff_id
    WHERE s.phone LIKE 'DEMO-WF-%' AND r.status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_demo_clinic_workforce() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_demo_clinic_workforce() TO service_role;

SELECT * FROM public.refresh_demo_clinic_workforce();

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'demo_clinic_workforce_refresh_0010kst';

SELECT cron.schedule(
  'demo_clinic_workforce_refresh_0010kst',
  '10 15 * * *',
  'select public.refresh_demo_clinic_workforce();'
);
