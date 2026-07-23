-- Product-completion pass: staff invitations, weekly schedules, exact QR
-- identity, and a shared leave-minute calculator.

ALTER TABLE public.facility_staff
  ADD COLUMN IF NOT EXISTS work_weekdays smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[];
ALTER TABLE public.facility_staff DROP CONSTRAINT IF EXISTS facility_staff_work_weekdays_check;
ALTER TABLE public.facility_staff ADD CONSTRAINT facility_staff_work_weekdays_check
  CHECK (
    cardinality(work_weekdays) BETWEEN 1 AND 7
    AND work_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
  );

CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT nullif(regexp_replace(COALESCE(p_phone,''), '[^0-9]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.link_facility_staff_worker_by_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker_id uuid;
BEGIN
  IF NEW.worker_id IS NULL AND public.normalize_phone(NEW.phone) IS NOT NULL THEN
    SELECT id INTO v_worker_id
    FROM public.workers
    WHERE public.normalize_phone(phone) = public.normalize_phone(NEW.phone)
      AND deleted_at IS NULL
    ORDER BY created_at
    LIMIT 1;
    NEW.worker_id := v_worker_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_facility_staff_worker_by_phone ON public.facility_staff;
CREATE TRIGGER trg_link_facility_staff_worker_by_phone
  BEFORE INSERT OR UPDATE OF phone ON public.facility_staff
  FOR EACH ROW EXECUTE FUNCTION public.link_facility_staff_worker_by_phone();

CREATE TABLE IF NOT EXISTS public.facility_staff_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  phone_normalized text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','cancelled','expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_by uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_facility_staff_invites_pending
  ON public.facility_staff_invites(facility_id, staff_id, status, expires_at);
ALTER TABLE public.facility_staff_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facility_staff_invites_admin_read ON public.facility_staff_invites;
CREATE POLICY facility_staff_invites_admin_read ON public.facility_staff_invites FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
REVOKE ALL ON public.facility_staff_invites FROM anon, authenticated;
GRANT SELECT ON public.facility_staff_invites TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_facility_staff_invite(p_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.facility_staff_invites%ROWTYPE;
  v_worker public.workers%ROWTYPE;
BEGIN
  SELECT * INTO v_worker FROM public.workers
  WHERE id = public.current_worker_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '워커 계정을 먼저 완료해 주세요.'; END IF;

  SELECT * INTO v_invite FROM public.facility_staff_invites
  WHERE token = p_token AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '유효하지 않거나 이미 사용한 초대예요.'; END IF;
  IF v_invite.expires_at <= now() THEN
    UPDATE public.facility_staff_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION '초대가 만료됐어요. 병원에 재발급을 요청해 주세요.';
  END IF;
  IF public.normalize_phone(v_worker.phone) IS NULL
     OR public.normalize_phone(v_worker.phone) <> v_invite.phone_normalized THEN
    RAISE EXCEPTION '병원이 등록한 연락처와 내 계정 연락처가 일치하지 않아요.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.facility_staff
    WHERE facility_id = v_invite.facility_id AND worker_id = v_worker.id
      AND id <> v_invite.staff_id
  ) THEN RAISE EXCEPTION '이미 이 병원의 다른 직원 정보와 연결돼 있어요.'; END IF;

  UPDATE public.facility_staff
  SET worker_id = v_worker.id, updated_at = now()
  WHERE id = v_invite.staff_id AND facility_id = v_invite.facility_id AND status <> 'ended';
  IF NOT FOUND THEN RAISE EXCEPTION '연결할 직원 정보를 찾지 못했어요.'; END IF;

  UPDATE public.facility_staff_invites SET
    status = 'accepted', accepted_by = v_worker.id, accepted_at = now()
  WHERE id = v_invite.id;
  RETURN v_invite.staff_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_staff_leave_minutes(
  p_staff_id uuid, p_leave_type text, p_start_date date, p_end_date date,
  p_hourly_minutes integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weekdays smallint[];
  v_days integer;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date
     OR extract(year from p_start_date) <> extract(year from p_end_date) THEN
    RAISE EXCEPTION '휴가는 같은 연도 안에서 올바른 날짜로 신청해 주세요.';
  END IF;
  IF p_leave_type NOT IN ('annual','half_day','quarter_day','hourly','sick','other') THEN
    RAISE EXCEPTION '휴가 유형을 확인해 주세요.';
  END IF;
  IF p_leave_type IN ('half_day','quarter_day','hourly') AND p_end_date <> p_start_date THEN
    RAISE EXCEPTION '부분 휴가는 하루만 신청할 수 있어요.';
  END IF;
  SELECT work_weekdays INTO v_weekdays FROM public.facility_staff WHERE id = p_staff_id;
  IF NOT FOUND THEN RAISE EXCEPTION '직원을 찾지 못했어요.'; END IF;
  IF NOT (extract(isodow from p_start_date)::smallint = ANY(v_weekdays))
     AND p_start_date = p_end_date THEN
    RAISE EXCEPTION '선택한 날짜는 이 직원의 근무요일이 아니에요.';
  END IF;
  IF p_leave_type = 'half_day' THEN RETURN 240; END IF;
  IF p_leave_type = 'quarter_day' THEN RETURN 120; END IF;
  IF p_leave_type = 'hourly' THEN
    IF p_hourly_minutes IS NULL OR p_hourly_minutes < 60 OR p_hourly_minutes > 420
       OR p_hourly_minutes % 60 <> 0 THEN
      RAISE EXCEPTION '시간차는 1시간 단위로 1~7시간까지 신청할 수 있어요.';
    END IF;
    RETURN p_hourly_minutes;
  END IF;
  SELECT count(*)::integer INTO v_days
  FROM generate_series(p_start_date, p_end_date, interval '1 day') AS day
  WHERE extract(isodow from day)::smallint = ANY(v_weekdays);
  IF v_days <= 0 THEN RAISE EXCEPTION '선택 기간에 근무일이 없어요.'; END IF;
  RETURN v_days * 480;
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
  v_minutes := public.calculate_staff_leave_minutes(
    v_staff.id, p_leave_type, p_start_date, p_end_date, p_hourly_minutes
  );
  IF EXISTS (
    SELECT 1 FROM public.staff_leave_requests
    WHERE staff_id = v_staff.id AND status IN ('pending','approved')
      AND start_date <= p_end_date AND end_date >= p_start_date
  ) THEN RAISE EXCEPTION '같은 기간에 이미 대기 또는 승인된 휴가가 있어요.'; END IF;
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

-- Return the exact staff id so duplicate facility names can never select the
-- wrong workplace in the worker UI.
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
  IF NOT FOUND THEN RAISE EXCEPTION '이 병원에 연결된 직원 계정이 아니거나 QR이 만료됐어요.'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION '병원에서 출퇴근하려면 위치 권한이 필요해요.';
  END IF;
  v_point := public.ST_SetSRID(public.ST_MakePoint(p_lng,p_lat),4326)::public.geography;
  SELECT name, public.ST_Distance(location, v_point) INTO v_facility_name, v_distance_m
  FROM public.facilities WHERE id = v_staff.facility_id;
  IF v_distance_m IS NULL OR v_distance_m > 250 THEN
    RAISE EXCEPTION '병원 반경 250m 안에서만 출퇴근할 수 있어요.';
  END IF;
  v_work_date := CASE
    WHEN v_staff.default_end_time <= v_staff.default_start_time AND v_now_time < v_staff.default_end_time
    THEN v_today - 1 ELSE v_today END;
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
    RETURN jsonb_build_object('action','check_in','status','approved','facility_name',v_facility_name,'staff_id',v_staff.id,'work_date',v_work_date);
  END IF;
  IF v_att.check_out_at IS NOT NULL THEN RAISE EXCEPTION '해당 근무일의 출퇴근 기록이 이미 완료됐어요.'; END IF;
  IF now() >= v_scheduled_end_at THEN
    UPDATE public.staff_attendances SET
      check_out_at = now(), checkout_requested_at = now(), check_out_location = v_point,
      status = 'completed', note = '예정 퇴근시간 이후 병원 QR 자동 승인', updated_at = now()
    WHERE id = v_att.id;
    RETURN jsonb_build_object('action','check_out','status','approved','facility_name',v_facility_name,'staff_id',v_staff.id,'work_date',v_work_date);
  END IF;
  UPDATE public.staff_attendances SET
    checkout_requested_at = now(), check_out_location = v_point, status = 'checkout_pending',
    note = '예정 퇴근시간 전 QR 퇴근 요청', updated_at = now()
  WHERE id = v_att.id;
  RETURN jsonb_build_object('action','check_out','status','pending','facility_name',v_facility_name,'staff_id',v_staff.id,'work_date',v_work_date);
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_phone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_facility_staff_invite(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calculate_staff_leave_minutes(uuid,text,date,date,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_staff_leave_request_v2(uuid,text,date,date,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_staff_qr_attendance(uuid,double precision,double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_facility_staff_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_staff_leave_minutes(uuid,text,date,date,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_staff_leave_request_v2(uuid,text,date,date,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_qr_attendance(uuid,double precision,double precision) TO authenticated;
