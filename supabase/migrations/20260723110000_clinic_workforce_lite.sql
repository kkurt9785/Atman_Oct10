-- Lightweight workforce management for clinics and small hospitals.
-- Hospital-managed staff remains separate from marketplace workers so the
-- facility, not Atman, determines each person's employment relationship.

CREATE TABLE IF NOT EXISTS public.facility_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  phone text,
  role text NOT NULL CHECK (role IN ('rn','na','coordinator','admin','other')),
  department text,
  source text NOT NULL DEFAULT 'direct' CHECK (source IN ('direct','atman','imported')),
  engagement_type text NOT NULL DEFAULT 'regular'
    CHECK (engagement_type IN ('regular','fixed_term','temporary','daily')),
  contract_start date,
  contract_end date,
  default_start_time time NOT NULL DEFAULT '09:00',
  default_end_time time NOT NULL DEFAULT '18:00',
  default_break_minutes integer NOT NULL DEFAULT 60 CHECK (default_break_minutes BETWEEN 0 AND 480),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','leave','ended')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contract_end IS NULL OR contract_start IS NULL OR contract_end >= contract_start)
);
CREATE INDEX IF NOT EXISTS idx_facility_staff_active
  ON public.facility_staff(facility_id, status, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_facility_staff_worker
  ON public.facility_staff(facility_id, worker_id) WHERE worker_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.staff_attendances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  scheduled_start time,
  scheduled_end time,
  check_in_at timestamptz,
  check_out_at timestamptz,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 480),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','working','checkout_pending','completed','late','absent','leave')),
  checkout_requested_at timestamptz,
  check_in_location geography(POINT, 4326),
  check_out_location geography(POINT, 4326),
  note text,
  corrected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  correction_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, work_date),
  CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at)
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_day
  ON public.staff_attendances(facility_id, work_date, status);

CREATE TABLE IF NOT EXISTS public.staff_leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  leave_year integer NOT NULL CHECK (leave_year BETWEEN 2020 AND 2100),
  granted_minutes integer NOT NULL DEFAULT 0 CHECK (granted_minutes >= 0),
  used_minutes integer NOT NULL DEFAULT 0 CHECK (used_minutes >= 0),
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, leave_year)
);

CREATE TABLE IF NOT EXISTS public.staff_leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.facility_staff(id) ON DELETE CASCADE,
  leave_type text NOT NULL DEFAULT 'annual'
    CHECK (leave_type IN ('annual','half_day','quarter_day','hourly','sick','other')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  requested_minutes integer NOT NULL CHECK (requested_minutes > 0),
  reason text,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_leave_requests
  ON public.staff_leave_requests(facility_id, start_date, status);

ALTER TABLE public.facility_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_leave_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_staff_read ON public.facility_staff;
CREATE POLICY facility_staff_read ON public.facility_staff FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
DROP POLICY IF EXISTS staff_attendances_read ON public.staff_attendances;
CREATE POLICY staff_attendances_read ON public.staff_attendances FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
DROP POLICY IF EXISTS staff_leave_balances_read ON public.staff_leave_balances;
CREATE POLICY staff_leave_balances_read ON public.staff_leave_balances FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
DROP POLICY IF EXISTS staff_leave_requests_read ON public.staff_leave_requests;
CREATE POLICY staff_leave_requests_read ON public.staff_leave_requests FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);

REVOKE INSERT, UPDATE, DELETE ON public.facility_staff, public.staff_attendances,
  public.staff_leave_balances, public.staff_leave_requests FROM anon, authenticated;
GRANT SELECT ON public.facility_staff, public.staff_attendances,
  public.staff_leave_balances, public.staff_leave_requests TO authenticated;

-- Attendance-first entry plan for facilities with up to ten managed staff.
INSERT INTO public.service_plans (
  code, name, monthly_fee, included_facilities, included_admin_seats,
  included_active_workers, included_attendance_slots, included_job_posting_slots,
  features, is_active, sort_order
) VALUES (
  'clinic', 'Clinic Lite', 39900, 1, 1, 0, 10, 3,
  '{"support":"standard","credential_status":true,"attendance":true,"leave_lite":true,"popular":false,"tagline":"직원 10명까지 간편 근태·휴가 관리"}',
  true, 15
)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name, monthly_fee=EXCLUDED.monthly_fee,
  included_facilities=EXCLUDED.included_facilities,
  included_admin_seats=EXCLUDED.included_admin_seats,
  included_active_workers=EXCLUDED.included_active_workers,
  included_attendance_slots=EXCLUDED.included_attendance_slots,
  included_job_posting_slots=EXCLUDED.included_job_posting_slots,
  features=EXCLUDED.features, is_active=true, sort_order=EXCLUDED.sort_order;

UPDATE public.service_plans SET included_attendance_slots = CASE code
  WHEN 'free' THEN 3
  WHEN 'basic' THEN 20
  WHEN 'pro' THEN 60
  WHEN 'enterprise' THEN 999999
  ELSE included_attendance_slots
END
WHERE code IN ('free','basic','pro','enterprise');

-- A facility posts this stable, revocable QR at the workplace. The QR contains
-- only an unguessable token and the worker's authenticated account determines
-- which staff record may use it.
CREATE TABLE IF NOT EXISTS public.facility_attendance_qr (
  facility_id uuid PRIMARY KEY REFERENCES public.facilities(id) ON DELETE CASCADE,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT true,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  rotated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.facility_attendance_qr ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_attendance_qr FROM anon, authenticated;

DROP POLICY IF EXISTS facility_staff_worker_read ON public.facility_staff;
CREATE POLICY facility_staff_worker_read ON public.facility_staff FOR SELECT
  USING (worker_id = public.current_worker_id());
DROP POLICY IF EXISTS staff_attendances_worker_read ON public.staff_attendances;
CREATE POLICY staff_attendances_worker_read ON public.staff_attendances FOR SELECT
  USING (staff_id IN (
    SELECT id FROM public.facility_staff WHERE worker_id = public.current_worker_id()
  ));
DROP POLICY IF EXISTS staff_leave_balances_worker_read ON public.staff_leave_balances;
CREATE POLICY staff_leave_balances_worker_read ON public.staff_leave_balances FOR SELECT
  USING (staff_id IN (
    SELECT id FROM public.facility_staff WHERE worker_id = public.current_worker_id()
  ));
DROP POLICY IF EXISTS staff_leave_requests_worker_read ON public.staff_leave_requests;
CREATE POLICY staff_leave_requests_worker_read ON public.staff_leave_requests FOR SELECT
  USING (staff_id IN (
    SELECT id FROM public.facility_staff WHERE worker_id = public.current_worker_id()
  ));

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
  SELECT public.ST_Distance(location, v_point) INTO v_distance_m
  FROM public.facilities WHERE id = v_staff.facility_id;
  IF v_distance_m IS NULL OR v_distance_m > 250 THEN
    RAISE EXCEPTION '병원 반경 250m 안에서만 출퇴근할 수 있어요.';
  END IF;

  SELECT name INTO v_facility_name FROM public.facilities WHERE id = v_staff.facility_id;
  SELECT * INTO v_att FROM public.staff_attendances
  WHERE staff_id = v_staff.id AND work_date = v_today FOR UPDATE;

  IF NOT FOUND OR v_att.check_in_at IS NULL THEN
    INSERT INTO public.staff_attendances (
      facility_id, staff_id, work_date, scheduled_start, scheduled_end,
      check_in_at, check_in_location, status, note
    ) VALUES (
      v_staff.facility_id, v_staff.id, v_today, v_staff.default_start_time,
      v_staff.default_end_time, now(), v_point,
      CASE WHEN v_now_time > v_staff.default_start_time THEN 'late' ELSE 'working' END,
      '직원 계정으로 병원 QR 출근'
    )
    ON CONFLICT (staff_id, work_date) DO UPDATE SET
      check_in_at = EXCLUDED.check_in_at, status = EXCLUDED.status,
      check_in_location = EXCLUDED.check_in_location,
      scheduled_start = EXCLUDED.scheduled_start, scheduled_end = EXCLUDED.scheduled_end,
      note = EXCLUDED.note, updated_at = now();
    RETURN jsonb_build_object('action','check_in','status','approved','facility_name',v_facility_name);
  END IF;

  IF v_att.check_out_at IS NOT NULL THEN
    RAISE EXCEPTION '오늘 출퇴근 기록이 이미 완료됐어요.';
  END IF;

  IF v_now_time >= COALESCE(v_att.scheduled_end, v_staff.default_end_time) THEN
    UPDATE public.staff_attendances SET
      check_out_at = now(), checkout_requested_at = now(), check_out_location = v_point, status = 'completed',
      note = '예정 퇴근시간 이후 병원 QR 자동 승인', updated_at = now()
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

CREATE OR REPLACE FUNCTION public.submit_staff_leave_request(
  p_leave_type text, p_start_date date, p_end_date date,
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
  WHERE worker_id = public.current_worker_id() AND status <> 'ended'
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION '연결된 직원 정보를 찾지 못했어요.'; END IF;
  IF p_end_date < p_start_date THEN RAISE EXCEPTION '휴가 날짜를 확인해 주세요.'; END IF;
  IF p_leave_type NOT IN ('annual','half_day','quarter_day','hourly','sick','other') THEN
    RAISE EXCEPTION '휴가 유형을 확인해 주세요.';
  END IF;
  IF p_leave_type IN ('half_day','quarter_day','hourly') AND p_end_date <> p_start_date THEN
    RAISE EXCEPTION '부분 휴가는 하루만 신청할 수 있어요.';
  END IF;
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

CREATE OR REPLACE FUNCTION public.decide_staff_leave_request(p_request_id uuid, p_decision text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.staff_leave_requests%ROWTYPE;
  v_balance public.staff_leave_balances%ROWTYPE;
  v_year integer;
  v_deducts_balance boolean;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION '승인 여부를 확인해 주세요.'; END IF;
  SELECT * INTO v_request FROM public.staff_leave_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND OR public.facility_access_role(v_request.facility_id) NOT IN ('owner','operator','super') THEN
    RAISE EXCEPTION '처리할 수 없는 휴가 신청이에요.';
  END IF;
  v_deducts_balance := v_request.leave_type IN ('annual','half_day','quarter_day','hourly');
  IF p_decision = 'approved' AND v_deducts_balance THEN
    v_year := extract(year from v_request.start_date)::integer;
    SELECT * INTO v_balance FROM public.staff_leave_balances
    WHERE staff_id = v_request.staff_id AND leave_year = v_year FOR UPDATE;
    IF NOT FOUND OR v_balance.granted_minutes - v_balance.used_minutes < v_request.requested_minutes THEN
      RAISE EXCEPTION '잔여 휴가가 부족해 승인할 수 없어요.';
    END IF;
    UPDATE public.staff_leave_balances SET
      used_minutes = used_minutes + v_request.requested_minutes, updated_at = now()
    WHERE id = v_balance.id;
  END IF;
  UPDATE public.staff_leave_requests SET
    status = p_decision, decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE id = v_request.id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_staff_qr_attendance(uuid,double precision,double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_staff_leave_request(text,date,date,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decide_staff_leave_request(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_staff_qr_attendance(uuid,double precision,double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_staff_leave_request(text,date,date,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_staff_leave_request(uuid,text) TO authenticated;
