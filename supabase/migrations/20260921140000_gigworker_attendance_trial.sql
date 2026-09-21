-- 긱워커: 사업장 검증·공고 모집과 분리된 위치 기반 근태 체험 워크스페이스

ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_registration_source_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_registration_source_check
  CHECK (registration_source IN ('invite', 'self_hira', 'self_kakao', 'demo', 'gigworker_trial'));

INSERT INTO public.service_plans (
  code, name, monthly_fee, included_facilities, included_admin_seats,
  included_active_workers, included_attendance_slots, included_job_posting_slots,
  features, is_active, sort_order
) VALUES (
  'gigworker_trial', '긱워커 근태 체험', 0, 1, 1, 3, 3, 0,
  '{"attendance": true, "gigworker": true, "trial_days": 30}'::jsonb, true, 5
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  monthly_fee = EXCLUDED.monthly_fee,
  included_active_workers = EXCLUDED.included_active_workers,
  included_attendance_slots = EXCLUDED.included_attendance_slots,
  included_job_posting_slots = EXCLUDED.included_job_posting_slots,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;

-- 일반 사업장의 30일 Pro 체험 트리거는 긱워커 전용 체험에는 적용하지 않는다.
CREATE OR REPLACE FUNCTION public.start_facility_pro_trial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_today date := (timezone('Asia/Seoul', now()))::date;
BEGIN
  IF NEW.registration_source = 'gigworker_trial' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.facility_subscriptions (
    facility_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, trial_started_at, trial_ends_at
  )
  SELECT NEW.id,
    CASE WHEN NEW.facility_type = 'pharmacy' THEN 'pharmacy_plus' ELSE 'pro' END,
    'active', 'monthly', v_today, v_today + 29, now(), v_today + 29
  WHERE NOT EXISTS (
    SELECT 1 FROM public.facility_subscriptions
    WHERE facility_id = NEW.id AND status IN ('pending', 'active', 'past_due')
  );
  RETURN NEW;
END;
$$;

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
  -- 현재 계정 모델은 관리자 1명당 소유 사업장 1개다. 기존 모집용 사업장과 섞이지 않게 명확히 막는다.
  IF EXISTS (SELECT 1 FROM public.facilities WHERE admin_user_id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION '이미 운영 중인 사업장이 있어요. 긱워커 근태는 새 관리자 계정에서 시작하거나 기존 사업장의 직원 관리에서 이용해 주세요.';
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

  INSERT INTO public.facility_subscriptions (
    facility_id, plan_code, status, billing_cycle,
    current_period_start, current_period_end, trial_started_at, trial_ends_at
  ) VALUES (
    v_id, 'gigworker_trial', 'active', 'monthly',
    v_today, v_today + 29, now(), v_today + 29
  );
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_gigworker_workspace(text,text,double precision,double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_gigworker_workspace(text,text,double precision,double precision) TO authenticated;

-- 직접 초대한 긱워커도 계약 기간·요일 밖에서는 본인 GPS로 출퇴근할 수 없다.
ALTER TABLE public.attendance_auth_logs
  DROP CONSTRAINT IF EXISTS attendance_auth_logs_failure_reason_check;
ALTER TABLE public.attendance_auth_logs
  ADD CONSTRAINT attendance_auth_logs_failure_reason_check
  CHECK (failure_reason IS NULL OR failure_reason IN (
    'OUT_OF_RANGE','GPS_ERROR','GPS_ACCURACY_LOW','QR_EXPIRED','QR_INVALID',
    'HOSPITAL_MISMATCH','TIME_NOT_ALLOWED','DUPLICATE_ATTENDANCE',
    'NOT_ASSIGNED','INVALID_STATE','ADMIN_REQUIRED','NETWORK_NOT_ALLOWED','NOT_SCHEDULED'
  ));

DO $attendance_schedule_patch$
DECLARE
  fn regprocedure := to_regprocedure(
    'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'
  );
  def text;
  patched text;
  needle text := $needle$
  IF v_failure IS NULL THEN
    IF p_action='check_in' AND$needle$;
  replacement text := $replacement$
  -- 시설 직원은 계약일과 지정 요일에만 직접 인증할 수 있다. 야간 근무는 이미 v_work_date를 전날로 보정했다.
  IF p_target_type='staff' AND (
    (v_staff.contract_start IS NOT NULL AND v_work_date < v_staff.contract_start)
    OR (v_staff.contract_end IS NOT NULL AND v_work_date > v_staff.contract_end)
    OR (COALESCE(cardinality(v_staff.work_weekdays), 0) > 0
      AND extract(isodow FROM v_work_date)::smallint <> ALL(v_staff.work_weekdays))
  ) THEN
    v_failure := 'NOT_SCHEDULED';
  END IF;

  IF v_failure IS NULL THEN
    IF p_action='check_in' AND$replacement$;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'record_unified_attendance not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF position('NOT_SCHEDULED' in def) > 0 THEN RETURN; END IF;
  patched := replace(def, needle, replacement);
  IF patched = def THEN
    RAISE EXCEPTION '근태 계약·요일 검증 지점을 찾지 못했습니다';
  END IF;
  patched := replace(patched,
    $message$        WHEN 'TIME_NOT_ALLOWED' THEN CASE WHEN p_action='check_in'$message$,
    $message$        WHEN 'NOT_SCHEDULED' THEN '오늘은 등록된 계약 기간 또는 근무요일이 아니에요. 관리자에게 확인해 주세요.'
        WHEN 'TIME_NOT_ALLOWED' THEN CASE WHEN p_action='check_in'$message$);
  IF position($message$WHEN 'NOT_SCHEDULED'$message$ in patched) = 0 THEN
    RAISE EXCEPTION '근태 계약·요일 안내문을 추가하지 못했습니다';
  END IF;
  EXECUTE patched;
END;
$attendance_schedule_patch$;
