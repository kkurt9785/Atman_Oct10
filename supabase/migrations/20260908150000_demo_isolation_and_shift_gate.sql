-- 데모/실사용 격리 + 승인 게이트 트리거 + 휴가 승인 NULL 안전화 + 데모 직원 이름 정합.
-- 각 함수는 프로덕션 정의(pg_get_functiondef)를 받아 해당 조건만 바꿨다.

CREATE OR REPLACE FUNCTION public.get_shift_notification_recipients(p_shift_id uuid)
 RETURNS TABLE(auth_user_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT DISTINCT w.auth_user_id
  FROM public.shifts s
  JOIN public.facilities f ON f.id = s.facility_id
  JOIN public.workers w
    ON s.required_role IN (w.role, 'any')
   AND (w.role IN ('rn', 'na', 'pharmacist') OR w.verification_status = 'approved')
   AND w.deleted_at IS NULL
   AND w.auth_user_id IS NOT NULL
  JOIN public.worker_location_prefs pref ON pref.worker_id = w.auth_user_id
  CROSS JOIN LATERAL jsonb_array_elements(pref.locations) loc
  WHERE s.id = p_shift_id
    AND s.audience = 'public'
    AND f.is_active = true
    AND COALESCE(f.is_demo, false) = COALESCE(w.is_demo, false) -- 데모 워커는 데모 사업장만, 실제 워커는 실제 사업장만
    AND f.deleted_at IS NULL
    AND COALESCE(loc->>'lat', '') ~ '^-?[0-9]+([.][0-9]+)?$'
    AND COALESCE(loc->>'lng', '') ~ '^-?[0-9]+([.][0-9]+)?$'
    AND (loc->>'lat')::double precision BETWEEN -90 AND 90
    AND (loc->>'lng')::double precision BETWEEN -180 AND 180
    AND public.ST_DWithin(
      f.location,
      public.ST_SetSRID(public.ST_MakePoint(
        (loc->>'lng')::double precision,
        (loc->>'lat')::double precision
      ), 4326)::public.geography,
      LEAST(30000, GREATEST(1000, COALESCE((loc->>'radius_km')::double precision, 5) * 1000))
    );
$function$
;

CREATE OR REPLACE FUNCTION public.get_shift_map_points_secure(p_shift_ids uuid[])
 RETURNS TABLE(shift_id uuid, lat double precision, lng double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    s.id,
    public.ST_Y(f.location::public.geometry) AS lat,
    public.ST_X(f.location::public.geometry) AS lng
  FROM public.shifts s
  JOIN public.facilities f ON f.id = s.facility_id
  JOIN public.workers w ON w.auth_user_id = auth.uid()
  WHERE s.id = ANY(COALESCE(p_shift_ids, ARRAY[]::uuid[]))
    AND cardinality(COALESCE(p_shift_ids, ARRAY[]::uuid[])) <= 100
    AND s.status = 'open'
    AND s.shift_date >= (timezone('Asia/Seoul', now()))::date
    AND s.required_role IN (w.role, 'any')
    AND (w.role IN ('rn', 'na', 'pharmacist') OR w.verification_status = 'approved')
    AND w.deleted_at IS NULL
    AND f.is_active = true
    AND f.deleted_at IS NULL
    AND COALESCE(f.is_demo, false) = COALESCE(w.is_demo, false);
$function$
;

CREATE OR REPLACE FUNCTION public.get_nearby_open_shifts_secure(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_pref_labels text[] DEFAULT NULL::text[])
 RETURNS TABLE(id uuid, facility_id uuid, shift_date date, start_time time without time zone, end_time time without time zone, is_overnight boolean, required_role text, hourly_wage numeric, estimated_total_pay numeric, description text, department text, notes text, facility_name text, address_text text, distance_m double precision, matched_by text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH me AS (
  SELECT
    w.id,
    w.role,
    w.activity_center,
    COALESCE(w.activity_radius_meters, 12000)::double precision AS radius_m
  FROM public.workers AS w
  WHERE w.auth_user_id = auth.uid()
    AND w.deleted_at IS NULL
    AND (w.role IN ('rn', 'na', 'pharmacist') OR w.verification_status = 'approved')
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
WHERE s.status = 'open' AND COALESCE(s.audience, 'public') = 'public'
  AND s.shift_date >= (timezone('Asia/Seoul', now()))::date
  AND f.is_active = true
  AND f.deleted_at IS NULL
  AND COALESCE(f.is_demo, false) = COALESCE((
    SELECT dw.is_demo FROM public.workers dw
    WHERE dw.auth_user_id = auth.uid() AND dw.deleted_at IS NULL
    LIMIT 1
  ), false)
GROUP BY
  s.id, s.facility_id, s.shift_date, s.start_time, s.end_time, s.is_overnight,
  s.required_role, s.hourly_wage, s.estimated_total_pay, s.description,
  s.department, s.notes, f.name, f.address_text
ORDER BY distance_m ASC, s.shift_date ASC, s.start_time ASC;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_to_shift(p_shift_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  IF NOT FOUND OR (v_worker.role NOT IN ('rn', 'na', 'pharmacist') AND v_worker.verification_status <> 'approved') THEN
    RAISE EXCEPTION '이 직군은 자격 심사 승인 후 지원할 수 있어요';
  END IF;

  SELECT * INTO v_shift
  FROM public.shifts
  WHERE id = p_shift_id
  FOR UPDATE;

  IF NOT FOUND OR v_shift.status <> 'open' THEN
    RAISE EXCEPTION '현재 지원할 수 없는 시프트예요';
  END IF;
  IF v_shift.audience = 'invited' AND v_shift.invited_worker_id <> v_worker.id THEN RAISE EXCEPTION '초대받은 워커만 지원할 수 있어요'; END IF; IF v_shift.shift_date < (timezone('Asia/Seoul', now()))::date THEN
    RAISE EXCEPTION '이미 지난 시프트예요';
  END IF;
  IF v_shift.required_role NOT IN (v_worker.role, 'any') THEN
    RAISE EXCEPTION '자격 조건이 맞지 않는 시프트예요';
  END IF;
  IF COALESCE((SELECT f.is_demo FROM public.facilities f WHERE f.id = v_shift.facility_id), false)
     IS DISTINCT FROM COALESCE(v_worker.is_demo, false) THEN
    -- 데모 워커↔실제 사업장, 실제 워커↔데모 사업장 모두 차단
    RAISE EXCEPTION '현재 지원할 수 없는 시프트예요';
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
$function$
;

CREATE OR REPLACE FUNCTION public.decide_staff_leave_request(p_request_id uuid, p_decision text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request public.staff_leave_requests%ROWTYPE;
  v_balance public.staff_leave_balances%ROWTYPE;
  v_year integer;
  v_deducts_balance boolean;
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION '승인 여부를 확인해 주세요.'; END IF;
  SELECT * INTO v_request FROM public.staff_leave_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND OR public.can_manage_facility(v_request.facility_id, ARRAY['owner','operator','super']::text[]) IS DISTINCT FROM true THEN
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
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_facility_approved_for_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT (f.approved_at IS NOT NULL OR COALESCE(f.registration_source, 'invite') NOT LIKE 'self_%')
    INTO v_ok FROM public.facilities f WHERE f.id = NEW.facility_id;
  IF v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION '사업장 확인이 끝나면 공고를 등록할 수 있어요. 보통 1영업일 안에 완료돼요.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_shifts_require_approved_facility ON public.shifts;
CREATE TRIGGER trg_shifts_require_approved_facility
  BEFORE INSERT ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.enforce_facility_approved_for_shift();

CREATE OR REPLACE FUNCTION public.refresh_demo_clinic_workforce()
 RETURNS TABLE(kind text, count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  DELETE FROM public.facility_staff
  WHERE phone LIKE 'DEMO-WF-%'
    AND facility_id IN (
      SELECT id FROM public.facilities
      WHERE is_demo = true AND business_registration_number LIKE 'DEMO-TARGET-%' AND facility_type <> 'pharmacy'
    );

  WITH ranked_facilities AS (
    SELECT id, row_number() OVER (ORDER BY business_registration_number) AS rn
    FROM public.facilities
    WHERE is_demo = true
      AND business_registration_number LIKE 'DEMO-TARGET-%'
      AND facility_type <> 'pharmacy'
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
      (1, '김민서', 'rn', '외래', 'regular', '09:00'::time, '18:00'::time),
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
  WHERE is_demo = true AND business_registration_number LIKE 'DEMO-TARGET-%' AND facility_type <> 'pharmacy'
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
$function$
;

UPDATE public.facility_staff SET name = '김민서 (데모)' WHERE id = '1db25f51-372c-4867-920e-b4b3104c80d9' AND name LIKE '김지영%';

SELECT (SELECT count(*) FROM pg_trigger WHERE tgname='trg_shifts_require_approved_facility') AS trigger_1,
       (SELECT name FROM public.facility_staff WHERE id='1db25f51-372c-4867-920e-b4b3104c80d9') AS demo_staff_name,
       (SELECT count(*) FROM pg_proc WHERE proname IN ('get_shift_notification_recipients','get_shift_map_points_secure','get_nearby_open_shifts_secure','apply_to_shift','decide_staff_leave_request','enforce_facility_approved_for_shift')) AS fns_6;