-- ============================================================================
-- P0 production hardening (2/3)
--   * secure shift discovery / apply / cancel / accept / reject
--   * single-use QR challenges
--   * atomic check-in, check-out, wage calculation, settlement, credit charge
-- ============================================================================

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS is_holiday boolean NOT NULL DEFAULT false;

ALTER TABLE public.shift_attendances
  ADD COLUMN IF NOT EXISTS check_out_token_verified boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','failed','discarded')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
  ON public.notification_outbox(next_attempt_at, created_at)
  WHERE status IN ('pending','failed');
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_outbox FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Secure discovery: auth.uid() and worker role are derived in the database.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_nearby_open_shifts_secure(
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_pref_labels text[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  facility_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  is_overnight boolean,
  required_role text,
  hourly_wage numeric,
  estimated_total_pay numeric,
  description text,
  department text,
  notes text,
  facility_name text,
  address_text text,
  distance_m double precision,
  matched_by text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
WITH me AS (
  SELECT
    w.id,
    w.role,
    w.activity_center,
    COALESCE(w.activity_radius_meters, 12000)::double precision AS radius_m
  FROM public.workers AS w
  WHERE w.auth_user_id = auth.uid()
    AND w.deleted_at IS NULL
    AND w.verification_status = 'approved'
),
prefs AS (
  SELECT
    public.ST_SetSRID(
      public.ST_MakePoint(
        (loc->>'lng')::double precision,
        (loc->>'lat')::double precision
      ),
      4326
    )::public.geography AS center,
    LEAST(30000, GREATEST(1000, COALESCE((loc->>'radius_km')::double precision, 12) * 1000)) AS radius_m
  FROM public.worker_location_prefs AS pref
  CROSS JOIN LATERAL jsonb_array_elements(pref.locations) AS loc
  WHERE pref.worker_id = auth.uid()
    AND COALESCE(loc->>'lat', '') ~ '^-?[0-9]+([.][0-9]+)?$'
    AND COALESCE(loc->>'lng', '') ~ '^-?[0-9]+([.][0-9]+)?$'
    AND (loc->>'lat')::double precision BETWEEN -90 AND 90
    AND (loc->>'lng')::double precision BETWEEN -180 AND 180
    AND (p_pref_labels IS NULL OR loc->>'label' = ANY (p_pref_labels))
),
centers AS (
  SELECT
    public.ST_SetSRID(public.ST_MakePoint(p_lng, p_lat), 4326)::public.geography AS center,
    12000::double precision AS radius_m,
    'gps'::text AS src
  WHERE p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
  UNION ALL
  SELECT center, radius_m, 'pref'::text FROM prefs
  UNION ALL
  SELECT m.activity_center, m.radius_m, 'fallback'::text
  FROM me AS m
  WHERE m.activity_center IS NOT NULL
    AND (p_lat IS NULL OR p_lng IS NULL)
    AND p_pref_labels IS NULL
    AND NOT EXISTS (SELECT 1 FROM prefs)
)
SELECT
  s.id,
  s.facility_id,
  s.shift_date,
  s.start_time,
  s.end_time,
  s.is_overnight,
  s.required_role,
  s.hourly_wage::numeric,
  s.estimated_total_pay::numeric,
  s.description,
  s.department,
  s.notes,
  f.name,
  f.address_text,
  MIN(public.ST_Distance(f.location, c.center)) AS distance_m,
  (array_agg(c.src ORDER BY public.ST_Distance(f.location, c.center)))[1] AS matched_by
FROM public.shifts AS s
JOIN public.facilities AS f ON f.id = s.facility_id
JOIN me ON s.required_role IN (me.role, 'any')
JOIN centers AS c ON public.ST_DWithin(f.location, c.center, c.radius_m)
WHERE s.status = 'open'
  AND s.shift_date >= (timezone('Asia/Seoul', now()))::date
  AND f.is_active = true
  AND f.deleted_at IS NULL
GROUP BY
  s.id, s.facility_id, s.shift_date, s.start_time, s.end_time, s.is_overnight,
  s.required_role, s.hourly_wage, s.estimated_total_pay, s.description,
  s.department, s.notes, f.name, f.address_text
ORDER BY distance_m ASC, s.shift_date ASC, s.start_time ASC;
$$;

REVOKE ALL ON FUNCTION public.get_nearby_open_shifts_secure(double precision,double precision,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nearby_open_shifts_secure(double precision,double precision,text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Worker application state changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_to_shift(p_shift_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_application_id uuid;
  v_start timestamp;
  v_end timestamp;
BEGIN
  SELECT * INTO v_worker
  FROM public.workers
  WHERE id = public.current_worker_id()
  FOR UPDATE;

  IF NOT FOUND OR v_worker.verification_status <> 'approved' THEN
    RAISE EXCEPTION '심사 승인 후 지원할 수 있어요';
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND OR v_shift.status <> 'open' THEN
    RAISE EXCEPTION '현재 지원할 수 없는 시프트예요';
  END IF;
  IF v_shift.shift_date < (timezone('Asia/Seoul', now()))::date THEN
    RAISE EXCEPTION '이미 지난 시프트예요';
  END IF;
  IF v_shift.required_role NOT IN (v_worker.role, 'any') THEN
    RAISE EXCEPTION '자격 조건이 맞지 않는 시프트예요';
  END IF;

  v_start := v_shift.shift_date + v_shift.start_time;
  v_end := v_shift.shift_date + v_shift.end_time
    + CASE WHEN v_shift.is_overnight THEN interval '1 day' ELSE interval '0 day' END;

  IF EXISTS (
    SELECT 1
    FROM public.shift_applications AS a
    JOIN public.shifts AS s ON s.id = a.shift_id
    WHERE a.worker_id = v_worker.id
      AND a.status = 'accepted'
      AND a.shift_id <> p_shift_id
      AND (s.shift_date + s.start_time) < v_end
      AND (
        s.shift_date + s.end_time
        + CASE WHEN s.is_overnight THEN interval '1 day' ELSE interval '0 day' END
      ) > v_start
  ) THEN
    RAISE EXCEPTION '같은 시간대에 확정된 다른 시프트가 있어요';
  END IF;

  SELECT id INTO v_application_id
  FROM public.shift_applications
  WHERE shift_id = p_shift_id AND worker_id = v_worker.id
  FOR UPDATE;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.shift_applications
      WHERE id = v_application_id AND status IN ('applied','accepted','completed')
    ) THEN
      RAISE EXCEPTION '이미 지원한 시프트예요';
    END IF;

    UPDATE public.shift_applications
    SET status = 'applied',
        applied_at = now(),
        responded_at = NULL,
        cancelled_at = NULL,
        checked_in_at = NULL,
        checked_out_at = NULL
    WHERE id = v_application_id;
  ELSE
    INSERT INTO public.shift_applications (shift_id, worker_id, status)
    VALUES (p_shift_id, v_worker.id, 'applied')
    RETURNING id INTO v_application_id;
  END IF;

  RETURN v_application_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_my_shift_application(p_application_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;

  UPDATE public.shift_applications
  SET status = 'cancelled', cancelled_at = now()
  WHERE id = p_application_id
    AND worker_id = v_worker_id
    AND status = 'applied';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_to_shift(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_my_shift_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_to_shift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_my_shift_application(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Facility response is atomic and emits a durable notification event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_shift_application(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app public.shift_applications%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_title text := '🎉 시프트 수락됐어요!';
  v_body text;
  v_start timestamp;
  v_end timestamp;
BEGIN
  SELECT * INTO v_app
  FROM public.shift_applications
  WHERE id = p_application_id
  FOR UPDATE;
  IF NOT FOUND OR v_app.status <> 'applied' THEN
    RAISE EXCEPTION '수락할 수 없는 지원이에요';
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = v_app.shift_id
  FOR UPDATE;
  IF NOT FOUND OR v_shift.status <> 'open' THEN
    RAISE EXCEPTION '이미 처리된 시프트예요';
  END IF;
  IF NOT public.can_manage_facility(v_shift.facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION '지원자를 수락할 권한이 없어요';
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = v_app.worker_id;
  IF NOT FOUND OR v_worker.verification_status <> 'approved' THEN
    RAISE EXCEPTION '승인된 워커만 수락할 수 있어요';
  END IF;

  -- A worker can apply to overlapping shifts, but only one may be accepted.
  -- The advisory lock serializes accepts across different facilities.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_worker.id::text, 1));
  v_start := v_shift.shift_date + v_shift.start_time;
  v_end := v_shift.shift_date + v_shift.end_time
    + CASE WHEN v_shift.is_overnight THEN interval '1 day' ELSE interval '0 day' END;
  IF EXISTS (
    SELECT 1
    FROM public.shift_applications AS accepted
    JOIN public.shifts AS other_shift ON other_shift.id = accepted.shift_id
    WHERE accepted.worker_id = v_worker.id
      AND accepted.status = 'accepted'
      AND accepted.id <> v_app.id
      AND (other_shift.shift_date + other_shift.start_time) < v_end
      AND (
        other_shift.shift_date + other_shift.end_time
        + CASE WHEN other_shift.is_overnight THEN interval '1 day' ELSE interval '0 day' END
      ) > v_start
  ) THEN
    RAISE EXCEPTION '해당 워커에게 같은 시간대의 확정 시프트가 있어요';
  END IF;

  UPDATE public.shifts
  SET status = 'matched',
      matched_worker_id = v_app.worker_id,
      matched_at = now(),
      updated_at = now()
  WHERE id = v_shift.id;

  UPDATE public.shift_applications
  SET status = 'accepted', responded_at = now()
  WHERE id = v_app.id;

  UPDATE public.shift_applications
  SET status = 'rejected', responded_at = now()
  WHERE shift_id = v_shift.id
    AND id <> v_app.id
    AND status = 'applied';

  v_body := format(
    '%s %s~%s · ₩%s',
    v_shift.shift_date,
    to_char(v_shift.start_time, 'HH24:MI'),
    to_char(v_shift.end_time, 'HH24:MI'),
    to_char(v_shift.estimated_total_pay, 'FM999,999,999')
  );

  INSERT INTO public.notification_outbox (
    worker_auth_user_id, event_type, dedupe_key, title, body, data
  ) VALUES (
    v_worker.auth_user_id,
    'shift.accepted',
    'shift.accepted:' || v_app.id::text,
    v_title,
    v_body,
    jsonb_build_object('type','accepted','applicationId',v_app.id,'shiftId',v_shift.id)
  ) ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, after_data
  ) VALUES (
    'admin', auth.uid(), 'shift_application.accept', 'shift_application', v_app.id,
    jsonb_build_object('shift_id', v_shift.id, 'worker_id', v_worker.id)
  );

  RETURN jsonb_build_object(
    'applicationId', v_app.id,
    'shiftId', v_shift.id,
    'workerId', v_worker.id,
    'workerAuthUserId', v_worker.auth_user_id,
    'workerName', v_worker.name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_shift_application(p_application_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app public.shift_applications%ROWTYPE;
  v_facility_id uuid;
BEGIN
  SELECT a, s.facility_id INTO v_app, v_facility_id
  FROM public.shift_applications AS a
  JOIN public.shifts AS s ON s.id = a.shift_id
  WHERE a.id = p_application_id
  FOR UPDATE OF a;

  IF NOT FOUND OR v_app.status <> 'applied' THEN
    RAISE EXCEPTION '거절할 수 없는 지원이에요';
  END IF;
  IF NOT public.can_manage_facility(v_facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION '지원자를 거절할 권한이 없어요';
  END IF;

  UPDATE public.shift_applications
  SET status = 'rejected', responded_at = now()
  WHERE id = p_application_id;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id
  ) VALUES (
    'admin', auth.uid(), 'shift_application.reject', 'shift_application', p_application_id
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_shift_application(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_shift_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_shift_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_shift_application(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- One-time QR challenge. The QR contains only the random bearer token; its
-- application, worker, TTL and use state remain server-side.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_qr_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  application_id uuid NOT NULL REFERENCES public.shift_applications(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid REFERENCES auth.users(id),
  action text CHECK (action IN ('checkin','checkout')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_qr_active
  ON public.attendance_qr_tokens(application_id, expires_at)
  WHERE used_at IS NULL;
ALTER TABLE public.attendance_qr_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_qr_tokens FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_attendance_qr(p_application_id uuid)
RETURNS TABLE(token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_app public.shift_applications%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_token text;
  v_expires timestamptz := now() + interval '60 seconds';
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;

  SELECT * INTO v_app
  FROM public.shift_applications
  WHERE id = p_application_id AND worker_id = v_worker_id
  FOR UPDATE;
  IF NOT FOUND OR v_app.status <> 'accepted' THEN
    RAISE EXCEPTION 'QR을 발급할 수 없는 지원 상태예요';
  END IF;

  SELECT * INTO v_shift FROM public.shifts WHERE id = v_app.shift_id;
  v_start_at := (v_shift.shift_date + v_shift.start_time) AT TIME ZONE 'Asia/Seoul';
  v_end_at := (
    v_shift.shift_date + v_shift.end_time
    + CASE WHEN v_shift.is_overnight THEN interval '1 day' ELSE interval '0 day' END
  ) AT TIME ZONE 'Asia/Seoul';

  IF now() < v_start_at - interval '4 hours' OR now() > v_end_at + interval '6 hours' THEN
    RAISE EXCEPTION '근무 시간 근처에서만 QR을 발급할 수 있어요';
  END IF;

  UPDATE public.attendance_qr_tokens
  SET used_at = now(), action = NULL
  WHERE application_id = p_application_id
    AND used_at IS NULL;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.attendance_qr_tokens (
    token_hash, application_id, worker_id, expires_at
  ) VALUES (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_application_id,
    v_worker_id,
    v_expires
  );

  RETURN QUERY SELECT v_token, v_expires;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_attendance_qr(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_attendance_qr(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Wage calculation parity with @itdat/wage-engine RULESET_2026 (single shift).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_shift_wage_secure(
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_hourly_wage integer,
  p_is_5plus boolean,
  p_is_holiday boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total integer;
  v_break integer;
  v_worked integer;
  v_night integer;
  v_overtime integer;
  v_base integer;
  v_overtime_premium integer := 0;
  v_night_premium integer := 0;
  v_holiday_premium integer := 0;
  v_gross integer;
  v_per_min numeric;
  v_within8 integer;
  v_over8 integer;
BEGIN
  IF p_check_out <= p_check_in THEN RAISE EXCEPTION '퇴근 시간이 출근 시간보다 빨라요'; END IF;
  v_total := floor(extract(epoch FROM (p_check_out - p_check_in)) / 60)::integer;
  IF v_total > 36 * 60 THEN RAISE EXCEPTION '근무 시간이 36시간을 초과할 수 없어요'; END IF;

  v_break := CASE WHEN v_total >= 480 THEN 60 WHEN v_total >= 240 THEN 30 ELSE 0 END;
  v_worked := GREATEST(0, v_total - v_break);

  SELECT LEAST(v_worked, count(*)::integer) INTO v_night
  FROM generate_series(
    p_check_in,
    p_check_out - interval '1 minute',
    interval '1 minute'
  ) AS generated_minute(minute_at)
  WHERE extract(hour FROM timezone('Asia/Seoul', minute_at)) >= 22
     OR extract(hour FROM timezone('Asia/Seoul', minute_at)) < 6;

  v_overtime := GREATEST(0, v_worked - 480);
  v_per_min := p_hourly_wage::numeric / 60;
  v_base := round(v_worked * v_per_min)::integer;

  IF p_is_5plus THEN
    v_night_premium := round(v_night * v_per_min * 0.5)::integer;
    IF p_is_holiday THEN
      v_within8 := LEAST(v_worked, 480);
      v_over8 := GREATEST(0, v_worked - 480);
      v_holiday_premium := round(
        v_within8 * v_per_min * 0.5 + v_over8 * v_per_min * 1.0
      )::integer;
    ELSE
      v_overtime_premium := round(v_overtime * v_per_min * 0.5)::integer;
    END IF;
  END IF;

  v_gross := v_base + v_overtime_premium + v_night_premium + v_holiday_premium;
  RETURN jsonb_build_object(
    'ruleVersion','2026.1',
    'totalMinutes',v_total,
    'breakMinutes',v_break,
    'workedMinutes',v_worked,
    'nightMinutes',v_night,
    'overtimeMinutes',v_overtime,
    'base',v_base,
    'overtimePremium',v_overtime_premium,
    'nightPremium',v_night_premium,
    'holidayPremium',v_holiday_premium,
    'gross',v_gross
  );
END;
$$;
REVOKE ALL ON FUNCTION public.calculate_shift_wage_secure(timestamptz,timestamptz,integer,boolean,boolean) FROM PUBLIC;

-- Secure balance helper: callable by facility users for their facility and by service_role.
CREATE OR REPLACE FUNCTION public.org_credit_balance(p_org_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.is_service_role() OR public.facility_access_role(p_org_id) IS NOT NULL THEN
      COALESCE((
        SELECT SUM(l.delta)::integer
        FROM public.credit_ledger AS l
        WHERE l.org_id = p_org_id
          AND (l.expires_at IS NULL OR l.expires_at > now())
      ), 0)
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION public.org_credit_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_credit_balance(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- QR consumption atomically performs either check-in or check-out/settlement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_attendance_qr(
  p_token text,
  p_facility_id uuid,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_qr public.attendance_qr_tokens%ROWTYPE;
  v_app public.shift_applications%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_worker public.workers%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_attendance public.shift_attendances%ROWTYPE;
  v_bank_id uuid;
  v_distance integer;
  v_point public.geography;
  v_now timestamptz := now();
  v_wage jsonb;
  v_gross integer;
  v_platform_fee integer;
  v_charge integer;
  v_balance integer;
  v_income_tax integer;
  v_local_tax integer;
  v_net_pay integer;
BEGIN
  IF NOT public.can_manage_facility(p_facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION 'QR을 처리할 권한이 없어요';
  END IF;
  IF p_token IS NULL OR length(p_token) < 32 THEN RAISE EXCEPTION '유효하지 않은 QR이에요'; END IF;

  SELECT * INTO v_qr
  FROM public.attendance_qr_tokens
  WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  FOR UPDATE;

  IF NOT FOUND OR v_qr.used_at IS NOT NULL OR v_qr.expires_at <= v_now THEN
    RAISE EXCEPTION '만료되었거나 이미 사용한 QR이에요';
  END IF;

  SELECT * INTO v_app
  FROM public.shift_applications
  WHERE id = v_qr.application_id
  FOR UPDATE;
  SELECT * INTO v_shift FROM public.shifts WHERE id = v_app.shift_id FOR UPDATE;
  SELECT * INTO v_worker FROM public.workers WHERE id = v_app.worker_id;
  SELECT * INTO v_facility FROM public.facilities WHERE id = v_shift.facility_id;

  IF v_shift.facility_id <> p_facility_id OR v_app.worker_id <> v_qr.worker_id THEN
    RAISE EXCEPTION '이 병원의 QR이 아니에요';
  END IF;
  IF v_app.status <> 'accepted' THEN RAISE EXCEPTION '수락된 시프트가 아니에요'; END IF;

  IF (p_lat IS NULL) <> (p_lng IS NULL) THEN
    RAISE EXCEPTION '위도와 경도를 함께 전송해 주세요';
  END IF;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    IF p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
      RAISE EXCEPTION '위치 정보가 올바르지 않아요';
    END IF;
    v_point := public.ST_SetSRID(public.ST_MakePoint(p_lng, p_lat), 4326)::public.geography;
    v_distance := round(public.ST_Distance(v_facility.location, v_point))::integer;
  ELSIF v_facility.attendance_geofence_required THEN
    RAISE EXCEPTION '병원 현장 확인을 위해 위치 권한이 필요해요';
  END IF;

  IF v_distance IS NOT NULL AND v_distance > v_facility.attendance_geofence_meters THEN
    RAISE EXCEPTION '병원에서 % m 떨어진 위치예요', v_distance;
  END IF;

  SELECT * INTO v_attendance
  FROM public.shift_attendances
  WHERE application_id = v_app.id
  FOR UPDATE;

  -- First scan: check-in.
  IF NOT FOUND THEN
    IF v_shift.shift_date <> (timezone('Asia/Seoul', v_now))::date THEN
      RAISE EXCEPTION '근무 당일에만 체크인할 수 있어요';
    END IF;

    INSERT INTO public.shift_attendances (
      shift_id, worker_id, application_id,
      check_in_at, check_in_location, check_in_distance_m, check_in_method
    ) VALUES (
      v_shift.id, v_worker.id, v_app.id,
      v_now, v_point, v_distance, 'qr'
    ) RETURNING * INTO v_attendance;

    UPDATE public.shift_applications
    SET checked_in_at = v_now
    WHERE id = v_app.id;
    UPDATE public.shifts
    SET status = 'in_progress', updated_at = v_now
    WHERE id = v_shift.id;

    UPDATE public.attendance_qr_tokens
    SET used_at = v_now, used_by = auth.uid(), action = 'checkin'
    WHERE id = v_qr.id;

    INSERT INTO public.attendance_audit (attendance_id, prev_hash, payload, payload_hash)
    VALUES (
      v_attendance.id,
      NULL,
      jsonb_build_object('action','checkin','at',v_now,'distance_m',v_distance),
      encode(extensions.digest(jsonb_build_object('action','checkin','at',v_now,'distance_m',v_distance)::text, 'sha256'), 'hex')
    );

    RETURN jsonb_build_object(
      'action','checkin',
      'workerName',v_worker.name,
      'shiftDate',v_shift.shift_date,
      'startTime',v_shift.start_time,
      'distanceM',v_distance
    );
  END IF;

  -- Second scan: check-out and settlement.
  IF v_attendance.check_out_at IS NOT NULL THEN
    RAISE EXCEPTION '이미 체크아웃 완료된 시프트예요';
  END IF;
  IF v_attendance.check_in_at IS NULL THEN
    RAISE EXCEPTION '체크인 기록이 없어요';
  END IF;

  v_wage := public.calculate_shift_wage_secure(
    v_attendance.check_in_at,
    v_now,
    v_shift.hourly_wage,
    COALESCE(v_facility.is_5plus, false),
    v_shift.is_holiday
  );
  v_gross := (v_wage->>'gross')::integer;
  v_platform_fee := round(v_gross * COALESCE(v_shift.platform_fee_rate, 0.12))::integer;
  v_charge := v_gross + v_platform_fee;

  -- Serialize all spend operations per facility to prevent negative-balance races.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_id::text, 0));
  v_balance := public.org_credit_balance(p_facility_id);
  IF v_balance IS NULL OR v_balance < v_charge THEN
    RAISE EXCEPTION '크레딧이 부족해요. 필요 금액: %, 현재 잔액: %', v_charge, COALESCE(v_balance, 0);
  END IF;

  SELECT id INTO v_bank_id
  FROM public.worker_bank_accounts
  WHERE worker_id = v_worker.id
    AND is_primary = true
    AND deleted_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_bank_id IS NULL THEN RAISE EXCEPTION '정산 계좌가 등록되지 않았어요'; END IF;

  v_income_tax := round(v_gross * 0.03)::integer;
  v_local_tax := round(v_income_tax * 0.1)::integer;
  v_net_pay := v_gross - v_income_tax - v_local_tax;

  INSERT INTO public.wage_calculations (
    attendance_id, org_id, worker_id, shift_id, rule_version,
    worked_minutes, night_minutes, overtime_minutes, break_minutes,
    base, overtime_premium, night_premium, holiday_premium, gross,
    breakdown, calculated_at
  ) VALUES (
    v_attendance.id, p_facility_id, v_worker.id, v_shift.id, v_wage->>'ruleVersion',
    (v_wage->>'workedMinutes')::integer,
    (v_wage->>'nightMinutes')::integer,
    (v_wage->>'overtimeMinutes')::integer,
    (v_wage->>'breakMinutes')::integer,
    (v_wage->>'base')::integer,
    (v_wage->>'overtimePremium')::integer,
    (v_wage->>'nightPremium')::integer,
    (v_wage->>'holidayPremium')::integer,
    v_gross,
    v_wage,
    v_now
  ) ON CONFLICT (attendance_id) DO NOTHING;

  INSERT INTO public.settlements (
    shift_id, worker_id, attendance_id, bank_account_id,
    gross_pay, platform_fee, income_tax, local_tax, net_pay, status
  ) VALUES (
    v_shift.id, v_worker.id, v_attendance.id, v_bank_id,
    v_gross, v_platform_fee, v_income_tax, v_local_tax, v_net_pay, 'pending'
  ) ON CONFLICT (attendance_id) DO NOTHING;

  -- Keep the statutory daily ledger in the same transaction as checkout.
  INSERT INTO public.payroll_ledger (
    org_id, worker_id, period_start, period_end, work_date,
    worked_minutes, overtime_minutes, night_minutes, holiday_minutes, day_gross
  ) VALUES (
    p_facility_id,
    v_worker.id,
    date_trunc('month', v_shift.shift_date::timestamp)::date,
    (date_trunc('month', v_shift.shift_date::timestamp) + interval '1 month - 1 day')::date,
    v_shift.shift_date,
    (v_wage->>'workedMinutes')::integer,
    (v_wage->>'overtimeMinutes')::integer,
    (v_wage->>'nightMinutes')::integer,
    CASE WHEN v_shift.is_holiday THEN (v_wage->>'workedMinutes')::integer ELSE 0 END,
    v_gross
  )
  ON CONFLICT (org_id, worker_id, work_date) DO UPDATE SET
    worked_minutes = public.payroll_ledger.worked_minutes + EXCLUDED.worked_minutes,
    overtime_minutes = public.payroll_ledger.overtime_minutes + EXCLUDED.overtime_minutes,
    night_minutes = public.payroll_ledger.night_minutes + EXCLUDED.night_minutes,
    holiday_minutes = public.payroll_ledger.holiday_minutes + EXCLUDED.holiday_minutes,
    day_gross = public.payroll_ledger.day_gross + EXCLUDED.day_gross;

  INSERT INTO public.credit_ledger (
    org_id, delta, kind, ref, created_at
  ) VALUES (
    p_facility_id, -v_charge, 'spend', v_shift.id::text, v_now
  );

  UPDATE public.shift_attendances
  SET check_out_at = v_now,
      check_out_location = v_point,
      check_out_distance_m = v_distance,
      check_out_qr_nonce = v_qr.id::text,
      check_out_hmac_verified = false,
      check_out_token_verified = true,
      check_out_method = 'qr',
      updated_at = v_now
  WHERE id = v_attendance.id;

  UPDATE public.shift_applications
  SET checked_out_at = v_now, status = 'completed'
  WHERE id = v_app.id;
  UPDATE public.shifts
  SET status = 'completed', updated_at = v_now
  WHERE id = v_shift.id;

  UPDATE public.attendance_qr_tokens
  SET used_at = v_now, used_by = auth.uid(), action = 'checkout'
  WHERE id = v_qr.id;

  INSERT INTO public.attendance_audit (attendance_id, prev_hash, payload, payload_hash)
  SELECT
    v_attendance.id,
    prior.payload_hash,
    jsonb_build_object(
      'action','checkout','at',v_now,'distance_m',v_distance,
      'gross',v_gross,'platform_fee',v_platform_fee,'charged',v_charge
    ),
    encode(extensions.digest(
      COALESCE(prior.payload_hash, '') || jsonb_build_object(
        'action','checkout','at',v_now,'distance_m',v_distance,
        'gross',v_gross,'platform_fee',v_platform_fee,'charged',v_charge
      )::text,
      'sha256'
    ), 'hex')
  FROM LATERAL (
    SELECT payload_hash
    FROM public.attendance_audit
    WHERE attendance_id = v_attendance.id
    ORDER BY seq DESC
    LIMIT 1
  ) AS prior;

  INSERT INTO public.notification_outbox (
    worker_auth_user_id, event_type, dedupe_key, title, body, data
  ) VALUES (
    v_worker.auth_user_id,
    'shift.checkout',
    'shift.checkout:' || v_attendance.id::text,
    '체크아웃과 정산 등록이 완료됐어요',
    format('총 임금 ₩%s · 정산 예정 ₩%s', to_char(v_gross,'FM999,999,999'), to_char(v_net_pay,'FM999,999,999')),
    jsonb_build_object('type','checkout','attendanceId',v_attendance.id,'gross',v_gross,'netPay',v_net_pay)
  ) ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, after_data
  ) VALUES (
    'admin', auth.uid(), 'attendance.checkout_settle', 'attendance', v_attendance.id,
    jsonb_build_object('gross',v_gross,'platform_fee',v_platform_fee,'charged',v_charge)
  );

  RETURN jsonb_build_object(
    'action','checkout',
    'workerName',v_worker.name,
    'shiftDate',v_shift.shift_date,
    'startTime',v_shift.start_time,
    'gross',v_gross,
    'platformFee',v_platform_fee,
    'charged',v_charge,
    'netPay',v_net_pay,
    'balance',v_balance - v_charge,
    'distanceM',v_distance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_attendance_qr(text,uuid,double precision,double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_attendance_qr(text,uuid,double precision,double precision) TO authenticated;
