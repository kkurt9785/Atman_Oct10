-- 카카오 초대 흐름을 관리자·워커 두 기기에서 반복 시연할 수 있는 전용 데이터.
-- 관리자: sales-demo-1 계정에서 긱워커 데모 근무지를 선택한다.
-- 워커: GIG2026 코드가 worker-demo-4로 로그인한 뒤 아래 초대를 매번 초기화한다.

DO $demo$
DECLARE
  v_admin uuid;
  v_worker public.workers%ROWTYPE;
  v_facility uuid;
  v_staff constant uuid := '20260922-0000-4000-8000-000000000004';
  v_invite constant uuid := '20260922-0000-4000-8000-000000000005';
  v_token constant uuid := '20260922-0000-4000-8000-000000000006';
BEGIN
  SELECT id INTO v_admin FROM auth.users WHERE email = 'sales-demo-1@demo.atman.co.kr';
  SELECT w.* INTO v_worker
  FROM public.workers w
  JOIN auth.users u ON u.id = w.auth_user_id
  WHERE u.email = 'worker-demo-4@demo.atman.co.kr'
    AND w.is_demo = true AND w.deleted_at IS NULL;

  IF v_admin IS NULL OR v_worker.id IS NULL OR public.normalize_phone(v_worker.phone) IS NULL THEN
    RAISE EXCEPTION '긱워커 데모용 관리자 또는 워커 계정이 준비되지 않았습니다.';
  END IF;

  INSERT INTO public.facilities (
    name, facility_type, business_registration_number, address_text, location,
    admin_user_id, is_active, approved_at, registration_source, plan_code, is_demo
  ) VALUES (
    '잇닿 팝업스토어 데모', 'gigworker', 'DEMO-GIGWORKER-2026', '수원시청역 팝업 행사장',
    public.ST_SetSRID(public.ST_MakePoint(127.0286, 37.2636), 4326)::public.geography,
    NULL, true, now(), 'gigworker_trial', 'gigworker_trial', true
  )
  ON CONFLICT (business_registration_number) DO UPDATE SET
    name = EXCLUDED.name,
    facility_type = EXCLUDED.facility_type,
    address_text = EXCLUDED.address_text,
    location = EXCLUDED.location,
    admin_user_id = NULL,
    is_active = true,
    approved_at = COALESCE(public.facilities.approved_at, now()),
    registration_source = 'gigworker_trial',
    plan_code = 'gigworker_trial',
    is_demo = true,
    deleted_at = NULL,
    updated_at = now()
  RETURNING id INTO v_facility;

  INSERT INTO public.facility_admin_access (user_id, facility_id, access_role, can_view_payroll)
  VALUES (v_admin, v_facility, 'super', true)
  ON CONFLICT (user_id, facility_id) DO UPDATE SET
    access_role = 'super', can_view_payroll = true;

  INSERT INTO public.facility_attendance_settings (
    facility_id, authentication_mode, gps_radius_meters,
    max_gps_accuracy_meters, qr_fallback_enabled
  ) VALUES (v_facility, 'gps_or_qr', 100, 150, true)
  ON CONFLICT (facility_id) DO UPDATE SET
    authentication_mode = EXCLUDED.authentication_mode,
    gps_radius_meters = EXCLUDED.gps_radius_meters,
    max_gps_accuracy_meters = EXCLUDED.max_gps_accuracy_meters,
    qr_fallback_enabled = true,
    updated_at = now();

  UPDATE public.facility_subscriptions
  SET plan_code = 'gigworker_trial', status = 'active', billing_cycle = 'monthly',
      current_period_start = current_date, current_period_end = NULL,
      trial_started_at = NULL, trial_ends_at = NULL, trial_converted_at = NULL,
      updated_at = now()
  WHERE facility_id = v_facility AND status IN ('pending', 'active', 'past_due');
  IF NOT FOUND THEN
    INSERT INTO public.facility_subscriptions (
      facility_id, plan_code, status, billing_cycle, current_period_start, current_period_end
    ) VALUES (v_facility, 'gigworker_trial', 'active', 'monthly', current_date, NULL);
  END IF;

  INSERT INTO public.facility_staff (
    id, facility_id, worker_id, name, phone, role, department, source,
    engagement_type, contract_start, contract_end, default_start_time,
    default_end_time, default_break_minutes, status, work_weekdays, created_by
  ) VALUES (
    v_staff, v_facility, NULL, v_worker.name, v_worker.phone, 'other', '팝업 행사 운영·고객 안내', 'direct',
    'temporary', current_date - 30, current_date + 365, '10:00', '18:00', 60,
    'active', ARRAY[1,2,3,4,5,6,7]::smallint[], v_admin
  )
  ON CONFLICT (id) DO UPDATE SET
    facility_id = EXCLUDED.facility_id,
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    engagement_type = EXCLUDED.engagement_type,
    contract_start = EXCLUDED.contract_start,
    contract_end = EXCLUDED.contract_end,
    default_start_time = EXCLUDED.default_start_time,
    default_end_time = EXCLUDED.default_end_time,
    default_break_minutes = EXCLUDED.default_break_minutes,
    status = 'active',
    work_weekdays = EXCLUDED.work_weekdays,
    updated_at = now();

  -- phone 트리거가 기존 데모 워커를 즉시 붙일 수 있으므로 초대 전 상태로 되돌린다.
  UPDATE public.facility_staff SET worker_id = NULL, updated_at = now() WHERE id = v_staff;

  UPDATE public.facility_staff_invites
  SET status = 'cancelled'
  WHERE staff_id = v_staff AND status = 'pending' AND id <> v_invite;

  INSERT INTO public.facility_staff_invites (
    id, facility_id, staff_id, token, phone_normalized, status,
    expires_at, accepted_by, accepted_at, created_by
  ) VALUES (
    v_invite, v_facility, v_staff, v_token, public.normalize_phone(v_worker.phone), 'pending',
    now() + interval '30 days', NULL, NULL, v_admin
  )
  ON CONFLICT (id) DO UPDATE SET
    facility_id = EXCLUDED.facility_id,
    staff_id = EXCLUDED.staff_id,
    token = EXCLUDED.token,
    phone_normalized = EXCLUDED.phone_normalized,
    status = 'pending',
    expires_at = now() + interval '30 days',
    accepted_by = NULL,
    accepted_at = NULL,
    created_by = EXCLUDED.created_by;
END
$demo$;

CREATE OR REPLACE FUNCTION public.reset_gigworker_invite_demo()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_facility uuid;
  v_staff constant uuid := '20260922-0000-4000-8000-000000000004';
  v_invite constant uuid := '20260922-0000-4000-8000-000000000005';
  v_token constant uuid := '20260922-0000-4000-8000-000000000006';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요.'; END IF;

  SELECT w.* INTO v_worker
  FROM public.workers w
  JOIN auth.users u ON u.id = w.auth_user_id
  WHERE w.auth_user_id = auth.uid()
    AND u.email = 'worker-demo-4@demo.atman.co.kr'
    AND w.is_demo = true AND w.deleted_at IS NULL;
  IF v_worker.id IS NULL THEN RAISE EXCEPTION '긱워커 데모 계정만 사용할 수 있어요.'; END IF;

  SELECT id INTO v_facility FROM public.facilities
  WHERE business_registration_number = 'DEMO-GIGWORKER-2026'
    AND is_demo = true AND is_active = true AND deleted_at IS NULL;
  IF v_facility IS NULL THEN RAISE EXCEPTION '긱워커 데모 근무지를 찾지 못했어요.'; END IF;

  UPDATE public.facility_staff
  SET phone = v_worker.phone, worker_id = NULL, status = 'active', updated_at = now()
  WHERE id = v_staff AND facility_id = v_facility;
  IF NOT FOUND THEN RAISE EXCEPTION '긱워커 데모 근무자를 찾지 못했어요.'; END IF;
  -- UPDATE OF phone 트리거가 자동 연결한 값을 초대 대기 상태로 다시 비운다.
  UPDATE public.facility_staff SET worker_id = NULL, updated_at = now() WHERE id = v_staff;

  UPDATE public.facility_staff_invites
  SET status = 'cancelled'
  WHERE staff_id = v_staff AND status = 'pending' AND id <> v_invite;

  INSERT INTO public.facility_staff_invites (
    id, facility_id, staff_id, token, phone_normalized, status,
    expires_at, accepted_by, accepted_at
  ) VALUES (
    v_invite, v_facility, v_staff, v_token, public.normalize_phone(v_worker.phone), 'pending',
    now() + interval '30 days', NULL, NULL
  )
  ON CONFLICT (id) DO UPDATE SET
    facility_id = EXCLUDED.facility_id,
    staff_id = EXCLUDED.staff_id,
    token = EXCLUDED.token,
    phone_normalized = EXCLUDED.phone_normalized,
    status = 'pending',
    expires_at = now() + interval '30 days',
    accepted_by = NULL,
    accepted_at = NULL;

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_gigworker_invite_demo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_gigworker_invite_demo() TO authenticated;

SELECT
  (SELECT count(*) FROM public.facilities WHERE business_registration_number = 'DEMO-GIGWORKER-2026' AND is_demo = true) AS demo_facility_1,
  (SELECT count(*) FROM public.facility_staff_invites WHERE id = '20260922-0000-4000-8000-000000000005') AS demo_invite_1;
