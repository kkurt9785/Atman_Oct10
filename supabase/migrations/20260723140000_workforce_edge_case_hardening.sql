-- Night-shift correctness, explicit workplace leave selection, and RPC grants.

CREATE OR REPLACE FUNCTION public.record_staff_qr_attendance(
  p_token uuid, p_lat double precision, p_lng double precision
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff public.facility_staff%ROWTYPE;
  v_att public.staff_attendances%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_now_time time := (now() AT TIME ZONE 'Asia/Seoul')::time;
  v_work_date date;
  v_scheduled_start_at timestamptz;
  v_scheduled_end_at timestamptz;
  v_facility_name text;
  v_point geography;
  v_distance_m double precision;
BEGIN
  SELECT fs.* INTO v_staff
  FROM public.facility_staff fs
  JOIN public.facility_attendance_qr q ON q.facility_id = fs.facility_id
  WHERE fs.worker_id = public.current_worker_id()
    AND fs.status = 'active' AND q.token = p_token AND q.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '이 병원에 연결된 직원 계정이 아니거나 QR이 만료됐어요.';
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION '병원에서 출퇴근하려면 위치 권한이 필요해요.';
  END IF;

  v_point := public.ST_SetSRID(public.ST_MakePoint(p_lng,p_lat),4326)::public.geography;
  SELECT name, public.ST_Distance(location, v_point)
    INTO v_facility_name, v_distance_m
  FROM public.facilities WHERE id = v_staff.facility_id;
  IF v_distance_m IS NULL OR v_distance_m > 250 THEN
    RAISE EXCEPTION '병원 반경 250m 안에서만 출퇴근할 수 있어요.';
  END IF;

  -- For 22:00~06:00, scans between midnight and 06:00 belong to yesterday.
  v_work_date := CASE
    WHEN v_staff.default_end_time <= v_staff.default_start_time
      AND v_now_time < v_staff.default_end_time
    THEN v_today - 1
    ELSE v_today
  END;
  v_scheduled_start_at := (v_work_date + v_staff.default_start_time) AT TIME ZONE 'Asia/Seoul';
  v_scheduled_end_at := (
    v_work_date + v_staff.default_end_time
    + CASE WHEN v_staff.default_end_time <= v_staff.default_start_time THEN interval '1 day' ELSE interval '0' END
  ) AT TIME ZONE 'Asia/Seoul';

  SELECT * INTO v_att FROM public.staff_attendances
  WHERE staff_id = v_staff.id AND work_date = v_work_date FOR UPDATE;

  IF NOT FOUND OR v_att.check_in_at IS NULL THEN
    INSERT INTO public.staff_attendances (
      facility_id, staff_id, work_date, scheduled_start, scheduled_end,
      check_in_at, check_in_location, status, note
    ) VALUES (
      v_staff.facility_id, v_staff.id, v_work_date, v_staff.default_start_time,
      v_staff.default_end_time, now(), v_point,
      CASE WHEN now() > v_scheduled_start_at THEN 'late' ELSE 'working' END,
      '직원 계정으로 병원 QR 출근'
    )
    ON CONFLICT (staff_id, work_date) DO UPDATE SET
      check_in_at = EXCLUDED.check_in_at, check_in_location = EXCLUDED.check_in_location,
      status = EXCLUDED.status, scheduled_start = EXCLUDED.scheduled_start,
      scheduled_end = EXCLUDED.scheduled_end, note = EXCLUDED.note, updated_at = now();
    RETURN jsonb_build_object('action','check_in','status','approved','facility_name',v_facility_name);
  END IF;

  IF v_att.check_out_at IS NOT NULL THEN
    RAISE EXCEPTION '해당 근무일의 출퇴근 기록이 이미 완료됐어요.';
  END IF;
  IF now() >= v_scheduled_end_at THEN
    UPDATE public.staff_attendances SET
      check_out_at = now(), checkout_requested_at = now(), check_out_location = v_point,
      status = 'completed', note = '예정 퇴근시간 이후 병원 QR 자동 승인', updated_at = now()
    WHERE id = v_att.id;
    RETURN jsonb_build_object('action','check_out','status','approved','facility_name',v_facility_name);
  END IF;

  UPDATE public.staff_attendances SET
    checkout_requested_at = now(), check_out_location = v_point, status = 'checkout_pending',
    note = '예정 퇴근시간 전 QR 퇴근 요청', updated_at = now()
  WHERE id = v_att.id;
  RETURN jsonb_build_object('action','check_out','status','pending','facility_name',v_facility_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_staff_leave_request_v2(
  p_staff_id uuid, p_leave_type text, p_start_date date, p_end_date date,
  p_hourly_minutes integer DEFAULT NULL, p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff public.facility_staff%ROWTYPE;
  v_minutes integer;
  v_id uuid;
BEGIN
  SELECT * INTO v_staff FROM public.facility_staff
  WHERE id = p_staff_id AND worker_id = public.current_worker_id() AND status <> 'ended';
  IF NOT FOUND THEN RAISE EXCEPTION '연결된 직원 정보를 찾지 못했어요.'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION '휴가 날짜를 확인해 주세요.';
  END IF;
  IF p_leave_type NOT IN ('annual','half_day','quarter_day','hourly','sick','other') THEN
    RAISE EXCEPTION '휴가 유형을 확인해 주세요.';
  END IF;
  IF p_leave_type IN ('half_day','quarter_day','hourly') AND p_end_date <> p_start_date THEN
    RAISE EXCEPTION '부분 휴가는 하루만 신청할 수 있어요.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff_leave_requests
    WHERE staff_id = v_staff.id AND status IN ('pending','approved')
      AND start_date <= p_end_date AND end_date >= p_start_date
  ) THEN RAISE EXCEPTION '같은 기간에 이미 대기 또는 승인된 휴가가 있어요.'; END IF;

  v_minutes := (p_end_date - p_start_date + 1) * 480;
  IF p_leave_type = 'half_day' THEN v_minutes := 240; END IF;
  IF p_leave_type = 'quarter_day' THEN v_minutes := 120; END IF;
  IF p_leave_type = 'hourly' THEN
    IF p_hourly_minutes IS NULL OR p_hourly_minutes < 60 OR p_hourly_minutes > 420
       OR p_hourly_minutes % 60 <> 0 THEN
      RAISE EXCEPTION '시간차는 1시간 단위로 1~7시간까지 신청할 수 있어요.';
    END IF;
    v_minutes := p_hourly_minutes;
  END IF;

  INSERT INTO public.staff_leave_requests (
    facility_id, staff_id, leave_type, start_date, end_date,
    requested_minutes, reason, status
  ) VALUES (
    v_staff.facility_id, v_staff.id, p_leave_type, p_start_date, p_end_date,
    v_minutes, nullif(trim(p_reason),''), 'pending'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_staff_qr_attendance(uuid,double precision,double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_staff_leave_request(text,date,date,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_staff_leave_request_v2(uuid,text,date,date,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_staff_leave_request(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_shift_map_points_secure(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_staff_qr_attendance(uuid,double precision,double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_staff_leave_request_v2(uuid,text,date,date,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_staff_leave_request(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_shift_map_points_secure(uuid[]) TO authenticated;
