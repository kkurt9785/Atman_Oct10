-- 긱워커 근태를 기간제 체험이 아닌 3명 무료 베타로 정리하고,
-- 초대 수락 전에 근무 조건을 안전하게 확인할 수 있게 한다.

UPDATE public.service_plans
SET name = '긱워커 근태 무료 베타',
    features = (COALESCE(features, '{}'::jsonb) - 'trial_days')
      || '{"attendance":true,"gigworker":true,"beta":true,"data_retained":true}'::jsonb
WHERE code = 'gigworker_trial';

-- 기존 체험은 데이터와 연결을 그대로 둔 채 무료 베타로 이어간다.
UPDATE public.facility_subscriptions
SET status = 'active',
    current_period_end = NULL,
    trial_started_at = NULL,
    trial_ends_at = NULL,
    trial_converted_at = NULL,
    updated_at = now()
WHERE plan_code = 'gigworker_trial';

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
  IF EXISTS (
    SELECT 1 FROM public.facilities
    WHERE admin_user_id = auth.uid() AND registration_source = 'gigworker_trial' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '이미 긱워커 근태 근무지가 있어요. 상단 근무지 선택에서 기존 근무지로 이동해 주세요.';
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

-- 초대 토큰을 가진 사람에게만 수락에 필요한 최소 정보만 보여준다.
-- 휴대전화 전체 번호와 내부 식별자는 노출하지 않는다.
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
    'payBasis', v_staff.pay_basis,
    'payRate', v_staff.pay_rate,
    'phoneLast4', right(v_invite.phone_normalized, 4),
    'expiresAt', v_invite.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_facility_staff_invite_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_facility_staff_invite_preview(uuid) TO anon, authenticated;

-- 기존에 사람이 수정하지 않은 긱워커 근무지도 실내 사용에 맞는 기본값으로 맞춘다.
UPDATE public.facility_attendance_settings s
SET gps_radius_meters = 100,
    max_gps_accuracy_meters = 150,
    qr_fallback_enabled = true,
    updated_at = now()
FROM public.facilities f
WHERE f.id = s.facility_id
  AND f.registration_source = 'gigworker_trial'
  AND f.deleted_at IS NULL
  AND s.updated_by IS NULL
  AND s.gps_radius_meters = 30;

SELECT
  (SELECT count(*) FROM public.service_plans WHERE code='gigworker_trial' AND name='긱워커 근태 무료 베타') AS beta_plan_1,
  (SELECT count(*) FROM pg_proc WHERE proname='get_facility_staff_invite_preview') AS invite_preview_fn_1;
