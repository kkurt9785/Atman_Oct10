-- 긱워커 근태 리뷰(9/22) 후속 핫픽스 4건
-- 1) NOT_SCHEDULED(계약기간·요일) 검증을 긱워커 근무지로 한정 — 병원·약국 정규직 주말 출근 차단 해제
-- 2) register_gigworker_workspace: admin_user_id UNIQUE 현실에 맞는 안내(기존 사업장 → 직원 관리)
-- 3) 초대 미리보기: 급여 조건은 로그인 후에만
-- 4) 출근 리마인더 데모 사업장 제외 + 대기 중 데모 리마인더 폐기

-- ── 1) NOT_SCHEDULED 를 gigworker_trial 근무지에만 ─────────────────────────
DO $scope_patch$
DECLARE
  fn regprocedure := to_regprocedure(
    'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'
  );
  def text;
  patched text;
  needle text := $needle$  IF p_target_type='staff' AND (
    (v_staff.contract_start IS NOT NULL AND v_work_date < v_staff.contract_start)$needle$;
  replacement text := $replacement$  IF p_target_type='staff' AND v_facility.registration_source = 'gigworker_trial' AND (
    (v_staff.contract_start IS NOT NULL AND v_work_date < v_staff.contract_start)$replacement$;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'record_unified_attendance not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF position('NOT_SCHEDULED' in def) = 0 THEN
    RAISE EXCEPTION 'NOT_SCHEDULED 검증(20260921140000)이 적용되지 않은 상태입니다';
  END IF;
  IF position($chk$registration_source = 'gigworker_trial' AND ($chk$ in def) > 0 THEN RETURN; END IF;
  patched := replace(def, needle, replacement);
  IF patched = def THEN
    RAISE EXCEPTION 'NOT_SCHEDULED 검증 지점을 찾지 못했습니다';
  END IF;
  EXECUTE patched;
END;
$scope_patch$;

-- ── 2) 기존 사업장 소유자 안내 (admin_user_id UNIQUE = 관리자당 소유 1개) ────
CREATE OR REPLACE FUNCTION public.register_gigworker_workspace(
  p_name text,
  p_address_text text,
  p_lng double precision,
  p_lat double precision
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_name text := btrim(COALESCE(p_name, ''));
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_is_admin boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION '관리자 계정만 근태를 시작할 수 있어요'; END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 100 THEN RAISE EXCEPTION '근무지 이름을 확인해 주세요'; END IF;
  IF p_lng IS NULL OR p_lat IS NULL OR p_lng NOT BETWEEN 124 AND 132 OR p_lat NOT BETWEEN 33 AND 39 THEN
    RAISE EXCEPTION '근무지 위치를 지도에서 확인해 주세요';
  END IF;
  -- facilities.admin_user_id 는 UNIQUE. 소유 사업장이 하나라도 있으면 이 RPC 는 성공할 수 없으므로
  -- unique violation 대신 갈 곳(직원 관리 > 단기근무 등록)을 알려 준다.
  IF EXISTS (SELECT 1 FROM public.facilities WHERE admin_user_id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION '이미 운영 중인 사업장이 있어요. 외부 단기근로자 초대는 직원 관리 > 단기근무 등록에서 이용해 주세요.';
  END IF;

  INSERT INTO public.facilities (
    name, facility_type, business_registration_number, address_text, location,
    admin_user_id, is_active, approved_at, registration_source, plan_code, is_demo
  ) VALUES (
    v_name, 'gigworker', 'GIG-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10)),
    COALESCE(NULLIF(btrim(COALESCE(p_address_text, '')), ''), '위치 기반 근무지'),
    public.ST_SetSRID(public.ST_MakePoint(p_lng, p_lat), 4326)::public.geography,
    auth.uid(), true, now(), 'gigworker_trial', 'gigworker_trial', false
  ) RETURNING id INTO v_id;

  -- 팝업·행사장 실내 GPS 오차를 고려해 무료 베타의 기본 반경은 100m로 둔다.
  INSERT INTO public.facility_attendance_settings (
    facility_id, authentication_mode, gps_radius_meters,
    max_gps_accuracy_meters, qr_fallback_enabled
  ) VALUES (v_id, 'gps_or_qr', 100, 150, true)
  ON CONFLICT (facility_id) DO UPDATE SET
    authentication_mode = CASE
      WHEN public.facility_attendance_settings.updated_by IS NULL THEN EXCLUDED.authentication_mode
      ELSE public.facility_attendance_settings.authentication_mode
    END,
    gps_radius_meters = CASE
      WHEN public.facility_attendance_settings.updated_by IS NULL THEN EXCLUDED.gps_radius_meters
      ELSE public.facility_attendance_settings.gps_radius_meters
    END,
    max_gps_accuracy_meters = CASE
      WHEN public.facility_attendance_settings.updated_by IS NULL THEN EXCLUDED.max_gps_accuracy_meters
      ELSE public.facility_attendance_settings.max_gps_accuracy_meters
    END,
    qr_fallback_enabled = CASE
      WHEN public.facility_attendance_settings.updated_by IS NULL THEN true
      ELSE public.facility_attendance_settings.qr_fallback_enabled
    END,
    updated_at = now();

  INSERT INTO public.facility_subscriptions (
    facility_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, trial_started_at, trial_ends_at
  ) VALUES (
    v_id, 'gigworker_trial', 'active', 'monthly',
    v_today, NULL, NULL, NULL
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_gigworker_workspace(text,text,double precision,double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_gigworker_workspace(text,text,double precision,double precision) TO authenticated;

-- ── 3) 초대 미리보기: 급여 조건은 로그인한 뒤에만 ────────────────────────────
-- 링크가 카톡으로 전달돼도 제3자가 급여까지 보지 못하게 한다. 이름·일정은 수락 판단에 필요해 유지.
CREATE OR REPLACE FUNCTION public.get_facility_staff_invite_preview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.facility_staff_invites%ROWTYPE;
  v_staff public.facility_staff%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_signed_in boolean := auth.uid() IS NOT NULL;
BEGIN
  SELECT * INTO v_invite
  FROM public.facility_staff_invites
  WHERE token = p_token;

  IF NOT FOUND OR v_invite.status IN ('cancelled','accepted') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID', 'message', '유효하지 않거나 이미 사용한 초대예요.');
  END IF;
  IF v_invite.status = 'expired' OR v_invite.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'EXPIRED', 'message', '초대가 만료됐어요. 관리자에게 새 링크를 요청해 주세요.');
  END IF;

  SELECT * INTO v_staff FROM public.facility_staff
  WHERE id = v_invite.staff_id AND facility_id = v_invite.facility_id AND status <> 'ended';
  SELECT * INTO v_facility FROM public.facilities
  WHERE id = v_invite.facility_id AND is_active = true AND deleted_at IS NULL;
  IF v_staff.id IS NULL OR v_facility.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID', 'message', '연결할 근무 정보를 찾지 못했어요.');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'isGigworker', v_facility.registration_source = 'gigworker_trial',
    'facilityName', v_facility.name,
    'facilityAddress', v_facility.address_text,
    'workerName', v_staff.name,
    'role', v_staff.role,
    'workDescription', v_staff.department,
    'contractStart', v_staff.contract_start,
    'contractEnd', v_staff.contract_end,
    'workWeekdays', v_staff.work_weekdays,
    'startTime', v_staff.default_start_time,
    'endTime', v_staff.default_end_time,
    'breakMinutes', v_staff.default_break_minutes,
    'payBasis', CASE WHEN v_signed_in THEN v_staff.pay_basis END,
    'payRate', CASE WHEN v_signed_in THEN v_staff.pay_rate END,
    'payHidden', (NOT v_signed_in) AND v_staff.pay_rate IS NOT NULL,
    'phoneLast4', right(v_invite.phone_normalized, 4),
    'expiresAt', v_invite.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_facility_staff_invite_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_facility_staff_invite_preview(uuid) TO anon, authenticated;

-- ── 4) 출근 리마인더: 데모 사업장 제외 (9/16 no_show 격리와 동일 원칙) ───────
CREATE OR REPLACE FUNCTION public.enqueue_attendance_reminders(p_lead_minutes integer DEFAULT 30, p_window_minutes integer DEFAULT 10)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_now timestamp := timezone('Asia/Seoul', now());
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_from time := (timezone('Asia/Seoul', now()) + make_interval(mins => p_lead_minutes))::time;
  v_to   time := (timezone('Asia/Seoul', now()) + make_interval(mins => p_lead_minutes + p_window_minutes))::time;
  v_count integer := 0;
BEGIN
  -- 자정 넘김 창은 다루지 않는다(새벽 출근은 다음 실행에서 자연히 잡힘)
  IF v_to < v_from THEN RETURN 0; END IF;

  -- 1) 기존 직원(사업장 직원 레코드 ↔ 워커 계정 연결). 데모 사업장·데모 워커는 제외.
  WITH targets AS (
    SELECT s.id AS staff_id, w.auth_user_id, f.name AS facility_name, s.default_start_time AS start_at
    FROM public.facility_staff s
    JOIN public.workers w ON w.id = s.worker_id AND w.auth_user_id IS NOT NULL AND w.deleted_at IS NULL AND w.is_demo = false
    JOIN public.facilities f ON f.id = s.facility_id AND f.is_active = true AND f.deleted_at IS NULL AND f.is_demo = false
    WHERE s.status = 'active'
      AND s.default_start_time IS NOT NULL
      AND s.default_start_time >= v_from AND s.default_start_time < v_to
      AND (s.work_weekdays IS NULL OR cardinality(s.work_weekdays) = 0 OR extract(isodow FROM v_today)::smallint = ANY (s.work_weekdays))
      AND (s.contract_start IS NULL OR s.contract_start <= v_today)
      AND (s.contract_end IS NULL OR s.contract_end >= v_today)
      AND NOT EXISTS (SELECT 1 FROM public.staff_attendances a WHERE a.staff_id = s.id AND a.work_date = v_today AND a.check_in_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.staff_leave_requests l WHERE l.staff_id = s.id AND l.status = 'approved' AND v_today BETWEEN l.start_date AND l.end_date)
  ), ins AS (
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT t.auth_user_id, 'attendance.reminder', 'attendance.reminder:staff:' || t.staff_id || ':' || v_today,
           p_lead_minutes || '분 뒤 출근이에요',
           t.facility_name || ' ' || to_char(t.start_at, 'HH24:MI') || ' 출근 예정이에요. 도착하면 앱에서 출근하기를 눌러 주세요.',
           jsonb_build_object('url', '/workplace', 'kind', 'attendance.reminder', 'staff_id', t.staff_id)
    FROM targets t
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM ins;

  -- 2) 확정된 단기 근무(지원 수락) — 아직 출근 전. 데모 제외.
  WITH targets AS (
    SELECT a.id AS application_id, w.auth_user_id, f.name AS facility_name, sh.start_time AS start_at
    FROM public.shift_applications a
    JOIN public.shifts sh ON sh.id = a.shift_id AND sh.shift_date = v_today AND sh.status IN ('open', 'matched', 'in_progress')
    JOIN public.workers w ON w.id = a.worker_id AND w.auth_user_id IS NOT NULL AND w.deleted_at IS NULL AND w.is_demo = false
    JOIN public.facilities f ON f.id = sh.facility_id AND f.is_active = true AND f.deleted_at IS NULL AND f.is_demo = false
    WHERE a.status = 'accepted' AND a.checked_in_at IS NULL
      AND sh.start_time >= v_from AND sh.start_time < v_to
  ), ins AS (
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT t.auth_user_id, 'attendance.reminder', 'attendance.reminder:app:' || t.application_id || ':' || v_today,
           p_lead_minutes || '분 뒤 출근이에요',
           t.facility_name || ' ' || to_char(t.start_at, 'HH24:MI') || ' 근무예요. 도착하면 앱에서 출근하기를 눌러 주세요.',
           jsonb_build_object('url', '/workplace', 'kind', 'attendance.reminder', 'application_id', t.application_id)
    FROM targets t
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  ) SELECT v_count + count(*) INTO v_count FROM ins;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_attendance_reminders(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_attendance_reminders(integer, integer) TO service_role;

-- 이미 큐에 들어간 데모 워커 리마인더는 폐기
UPDATE public.notification_outbox o
SET status = 'discarded', last_error = 'demo worker reminder (2026-09-22 gigworker hotfix)'
WHERE o.status = 'pending'
  AND o.event_type = 'attendance.reminder'
  AND EXISTS (SELECT 1 FROM public.workers w WHERE w.auth_user_id = o.worker_auth_user_id AND w.is_demo = true);

-- ── 검증 ─────────────────────────────────────────────────────────────────────
SELECT
  (SELECT position($c$registration_source = 'gigworker_trial' AND ($c$ in pg_get_functiondef(
     to_regprocedure('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'))) > 0) AS not_scheduled_scoped_t,
  (SELECT position('직원 관리 > 단기근무 등록' in pg_get_functiondef(
     to_regprocedure('public.register_gigworker_workspace(text,text,double precision,double precision)'))) > 0) AS workspace_msg_t,
  (SELECT position('payHidden' in pg_get_functiondef(
     to_regprocedure('public.get_facility_staff_invite_preview(uuid)'))) > 0) AS preview_pay_gated_t,
  (SELECT position('f.is_demo = false' in pg_get_functiondef(
     to_regprocedure('public.enqueue_attendance_reminders(integer,integer)'))) > 0) AS reminder_demo_excluded_t,
  (SELECT count(*) FROM public.notification_outbox o
     WHERE o.status = 'pending' AND o.event_type = 'attendance.reminder'
       AND EXISTS (SELECT 1 FROM public.workers w WHERE w.auth_user_id = o.worker_auth_user_id AND w.is_demo = true)) AS demo_reminders_pending_0;
