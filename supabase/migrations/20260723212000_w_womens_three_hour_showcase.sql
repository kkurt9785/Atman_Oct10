-- W여성병원 전용 시연 공고: 3시간마다 새 공고와 지원자 3명을 교체한다.
-- 수락되어 확정된 시프트는 삭제하지 않는다.
CREATE OR REPLACE FUNCTION public.refresh_w_womens_three_hour_shift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_facility_id uuid;
  v_shift_id uuid;
  v_local_now timestamp := timezone('Asia/Seoul', now());
  v_start_at timestamp;
  v_end_at timestamp;
  v_hourly_wage integer := 18000;
  v_applicants integer := 0;
BEGIN
  SELECT id INTO v_facility_id
  FROM public.facilities
  WHERE name = 'W여성병원'
    AND is_demo = true
    AND is_active = true
    AND deleted_at IS NULL
  ORDER BY business_registration_number
  LIMIT 1;

  IF v_facility_id IS NULL THEN
    RAISE EXCEPTION 'W여성병원 데모 시설을 찾지 못했어요';
  END IF;

  -- 다음 3시간 경계부터 근무가 시작된다.
  v_start_at := date_trunc('day', v_local_now)
    + ((floor(extract(hour FROM v_local_now) / 3) + 1) * interval '3 hours');
  v_end_at := v_start_at + interval '3 hours';

  DELETE FROM public.shift_applications
  WHERE shift_id IN (
    SELECT id FROM public.shifts
    WHERE facility_id = v_facility_id
      AND status = 'open'
      AND (notes LIKE 'DEMO-W-SHIFT-3H-%' OR notes LIKE 'DEMO-SHOWCASE-OPEN-%')
  );
  DELETE FROM public.shifts
  WHERE facility_id = v_facility_id
    AND status = 'open'
    AND (notes LIKE 'DEMO-W-SHIFT-3H-%' OR notes LIKE 'DEMO-SHOWCASE-OPEN-%');

  INSERT INTO public.shifts (
    facility_id, required_role, shift_date, start_time, end_time,
    hourly_wage, estimated_total_pay, description, department, notes, status
  ) VALUES (
    v_facility_id, 'rn', v_start_at::date, v_start_at::time, v_end_at::time,
    v_hourly_wage, v_hourly_wage * 3,
    'W여성병원 3시간 단위 시연 공고입니다. 지원 수락 후 오늘 확정 인력과 근태 관리로 연결됩니다.',
    '외래·병동 지원',
    'DEMO-W-SHIFT-3H-' || to_char(v_start_at, 'YYYYMMDDHH24'),
    'open'
  )
  RETURNING id INTO v_shift_id;

  INSERT INTO public.shift_applications (
    shift_id, worker_id, status, match_score, distance_meters, applied_at
  )
  SELECT
    v_shift_id,
    candidate.id,
    'applied',
    96 - candidate.rn,
    450 + candidate.rn * 230,
    now() - candidate.rn * interval '7 minutes'
  FROM (
    SELECT w.id, row_number() OVER (
      ORDER BY md5(w.id::text || to_char(v_start_at, 'YYYYMMDDHH24'))
    ) AS rn
    FROM public.workers w
    WHERE w.is_demo = true
      AND w.verification_status = 'approved'
      AND w.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.shift_applications accepted
        JOIN public.shifts other_shift ON other_shift.id = accepted.shift_id
        WHERE accepted.worker_id = w.id
          AND accepted.status = 'accepted'
          AND (other_shift.shift_date + other_shift.start_time) < v_end_at
          AND (
            other_shift.shift_date + other_shift.end_time
            + CASE WHEN other_shift.is_overnight THEN interval '1 day' ELSE interval '0 day' END
          ) > v_start_at
      )
  ) candidate
  WHERE candidate.rn <= 3;

  GET DIAGNOSTICS v_applicants = ROW_COUNT;
  RETURN jsonb_build_object(
    'facilityId', v_facility_id,
    'shiftId', v_shift_id,
    'startsAt', v_start_at,
    'applicants', v_applicants
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_w_womens_three_hour_shift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_w_womens_three_hour_shift() TO service_role;

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname = 'w_womens_showcase_every_3_hours';

SELECT cron.schedule(
  'w_womens_showcase_every_3_hours',
  '0 */3 * * *',
  'select public.refresh_w_womens_three_hour_shift();'
);

SELECT public.refresh_w_womens_three_hour_shift();

