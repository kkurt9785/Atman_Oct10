-- 워커 휴가 신청의 날짜·근태 충돌을 서버에서 차단하고,
-- 대기 신청은 삭제 대신 cancelled 상태로 남겨 취소할 수 있게 한다.
CREATE OR REPLACE FUNCTION public.submit_staff_leave_request_v2(
  p_staff_id uuid, p_leave_type text, p_start_date date, p_end_date date,
  p_hourly_minutes integer DEFAULT NULL, p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_staff public.facility_staff%ROWTYPE;
  v_minutes integer;
  v_id uuid;
BEGIN
  SELECT * INTO v_staff FROM public.facility_staff
  WHERE id = p_staff_id AND worker_id = public.current_worker_id() AND status <> 'ended';
  IF NOT FOUND THEN RAISE EXCEPTION '연결된 직원 정보를 찾지 못했어요.'; END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date
     OR p_start_date < (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION '오늘 이후 날짜로 휴가를 신청해 주세요.';
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
  IF EXISTS (
    SELECT 1 FROM public.staff_attendances
    WHERE staff_id = v_staff.id AND work_date BETWEEN p_start_date AND p_end_date
      AND (check_in_at IS NOT NULL OR check_out_at IS NOT NULL)
  ) THEN RAISE EXCEPTION '이미 출퇴근 기록이 있는 날짜에는 휴가를 신청할 수 없어요.'; END IF;

  v_minutes := public.calculate_staff_leave_minutes(v_staff.id, p_leave_type, p_start_date, p_end_date, p_hourly_minutes);
  INSERT INTO public.staff_leave_requests (facility_id, staff_id, leave_type, start_date, end_date, requested_minutes, reason, status)
  VALUES (v_staff.facility_id, v_staff.id, p_leave_type, p_start_date, p_end_date, v_minutes, nullif(trim(p_reason),''), 'pending')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_staff_leave_request(p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_request public.staff_leave_requests%ROWTYPE;
BEGIN
  SELECT r.* INTO v_request
  FROM public.staff_leave_requests r
  JOIN public.facility_staff s ON s.id = r.staff_id
  WHERE r.id = p_request_id AND s.worker_id = public.current_worker_id()
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION '대기 중인 휴가 신청만 취소할 수 있어요.';
  END IF;
  UPDATE public.staff_leave_requests
  SET status = 'cancelled', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE id = p_request_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_staff_leave_request_v2(uuid,text,date,date,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_staff_leave_request_v2(uuid,text,date,date,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_staff_leave_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_staff_leave_request(uuid) TO authenticated;

SELECT to_regprocedure('public.cancel_staff_leave_request(uuid)') IS NOT NULL AS cancel_rpc_ready;
