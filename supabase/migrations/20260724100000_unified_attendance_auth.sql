-- Unified authentication layer for hospital-managed staff and shift workers.
-- Existing attendance ledgers stay intact for payroll compatibility.

CREATE TABLE IF NOT EXISTS public.facility_attendance_settings (
  facility_id uuid PRIMARY KEY REFERENCES public.facilities(id) ON DELETE CASCADE,
  authentication_mode text NOT NULL DEFAULT 'gps_or_qr'
    CHECK (authentication_mode IN ('gps','gps_qr','qr','admin','gps_or_qr')),
  gps_radius_meters integer NOT NULL DEFAULT 30
    CHECK (gps_radius_meters IN (10,20,30,50,100)),
  max_gps_accuracy_meters integer NOT NULL DEFAULT 80
    CHECK (max_gps_accuracy_meters BETWEEN 10 AND 500),
  qr_fallback_enabled boolean NOT NULL DEFAULT true,
  check_in_before_minutes integer NOT NULL DEFAULT 60 CHECK (check_in_before_minutes BETWEEN 0 AND 360),
  check_in_after_minutes integer NOT NULL DEFAULT 60 CHECK (check_in_after_minutes BETWEEN 0 AND 360),
  check_out_before_minutes integer NOT NULL DEFAULT 60 CHECK (check_out_before_minutes BETWEEN 0 AND 360),
  check_out_after_minutes integer NOT NULL DEFAULT 120 CHECK (check_out_after_minutes BETWEEN 0 AND 720),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.facility_attendance_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facility_attendance_settings_read ON public.facility_attendance_settings;
CREATE POLICY facility_attendance_settings_read ON public.facility_attendance_settings FOR SELECT
  USING (
    public.facility_access_role(facility_id) IS NOT NULL
    OR facility_id IN (
      SELECT facility_id FROM public.facility_staff
      WHERE worker_id = public.current_worker_id() AND status <> 'ended'
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.facility_attendance_settings FROM anon, authenticated;
GRANT SELECT ON public.facility_attendance_settings TO authenticated;

INSERT INTO public.facility_attendance_settings(facility_id)
SELECT id FROM public.facilities
WHERE is_active = true AND deleted_at IS NULL
ON CONFLICT (facility_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.facility_attendance_qr_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  CHECK (expires_at > issued_at)
);
CREATE INDEX IF NOT EXISTS idx_facility_attendance_qr_challenges_active
  ON public.facility_attendance_qr_challenges(facility_id,expires_at)
  WHERE revoked_at IS NULL;
ALTER TABLE public.facility_attendance_qr_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facility_attendance_qr_challenges FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.attendance_auth_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.facility_staff(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.shift_applications(id) ON DELETE SET NULL,
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE CASCADE,
  staff_attendance_id uuid REFERENCES public.staff_attendances(id) ON DELETE SET NULL,
  shift_attendance_id uuid REFERENCES public.shift_attendances(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('staff','shift')),
  action text NOT NULL CHECK (action IN ('check_in','check_out')),
  authentication_method text NOT NULL
    CHECK (authentication_method IN ('GPS','GPS_QR','QR','QR_FALLBACK','ADMIN')),
  latitude double precision,
  longitude double precision,
  gps_accuracy_meters integer,
  distance_meters integer,
  qr_token_hash text,
  result text NOT NULL CHECK (result IN ('SUCCESS','FAIL')),
  failure_reason text CHECK (failure_reason IS NULL OR failure_reason IN (
    'OUT_OF_RANGE','GPS_ERROR','GPS_ACCURACY_LOW','QR_EXPIRED','QR_INVALID',
    'HOSPITAL_MISMATCH','TIME_NOT_ALLOWED','DUPLICATE_ATTENDANCE',
    'NOT_ASSIGNED','INVALID_STATE','ADMIN_REQUIRED'
  )),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_auth_logs_facility_created
  ON public.attendance_auth_logs(facility_id,created_at DESC);
ALTER TABLE public.attendance_auth_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_auth_logs_admin_read ON public.attendance_auth_logs;
CREATE POLICY attendance_auth_logs_admin_read ON public.attendance_auth_logs FOR SELECT
  USING (public.facility_access_role(facility_id) IS NOT NULL);
DROP POLICY IF EXISTS attendance_auth_logs_worker_read ON public.attendance_auth_logs;
CREATE POLICY attendance_auth_logs_worker_read ON public.attendance_auth_logs FOR SELECT
  USING (user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.attendance_auth_logs FROM anon, authenticated;
GRANT SELECT ON public.attendance_auth_logs TO authenticated;

ALTER TABLE public.staff_attendances
  ADD COLUMN IF NOT EXISTS check_in_method text,
  ADD COLUMN IF NOT EXISTS check_out_method text,
  ADD COLUMN IF NOT EXISTS check_in_distance_m integer,
  ADD COLUMN IF NOT EXISTS check_out_distance_m integer,
  ADD COLUMN IF NOT EXISTS check_in_gps_accuracy_m integer,
  ADD COLUMN IF NOT EXISTS check_out_gps_accuracy_m integer,
  ADD COLUMN IF NOT EXISTS check_in_status text,
  ADD COLUMN IF NOT EXISTS check_out_status text,
  ADD COLUMN IF NOT EXISTS late_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_leave_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.staff_attendances DROP CONSTRAINT IF EXISTS staff_attendances_check_in_method_check;
ALTER TABLE public.staff_attendances ADD CONSTRAINT staff_attendances_check_in_method_check
  CHECK (check_in_method IS NULL OR check_in_method IN ('GPS','GPS_QR','QR','QR_FALLBACK','ADMIN'));
ALTER TABLE public.staff_attendances DROP CONSTRAINT IF EXISTS staff_attendances_check_out_method_check;
ALTER TABLE public.staff_attendances ADD CONSTRAINT staff_attendances_check_out_method_check
  CHECK (check_out_method IS NULL OR check_out_method IN ('GPS','GPS_QR','QR','QR_FALLBACK','ADMIN'));

ALTER TABLE public.shift_attendances
  ADD COLUMN IF NOT EXISTS check_in_gps_accuracy_m integer,
  ADD COLUMN IF NOT EXISTS check_out_gps_accuracy_m integer,
  ADD COLUMN IF NOT EXISTS check_in_status text,
  ADD COLUMN IF NOT EXISTS check_out_status text,
  ADD COLUMN IF NOT EXISTS late_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_leave_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.shift_attendances DROP CONSTRAINT IF EXISTS shift_attendances_check_in_method_check;
ALTER TABLE public.shift_attendances ADD CONSTRAINT shift_attendances_check_in_method_check
  CHECK (check_in_method IS NULL OR check_in_method IN ('button','qr','GPS','GPS_QR','QR','QR_FALLBACK','ADMIN'));
ALTER TABLE public.shift_attendances DROP CONSTRAINT IF EXISTS shift_attendances_check_out_method_check;
ALTER TABLE public.shift_attendances ADD CONSTRAINT shift_attendances_check_out_method_check
  CHECK (check_out_method IS NULL OR check_out_method IN ('qr','manual_override','GPS','GPS_QR','QR','QR_FALLBACK','ADMIN'));

CREATE OR REPLACE FUNCTION public.issue_facility_attendance_qr(p_facility_id uuid)
RETURNS TABLE(token text, issued_at timestamptz, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token text;
  v_issued timestamptz := clock_timestamp();
  v_expires timestamptz := v_issued + interval '60 seconds';
BEGIN
  IF NOT public.can_manage_facility(p_facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION '동적 QR을 표시할 권한이 없어요';
  END IF;
  UPDATE public.facility_attendance_qr_challenges AS challenge
  SET revoked_at = v_issued
  WHERE challenge.facility_id = p_facility_id
    AND challenge.revoked_at IS NULL
    AND challenge.expires_at > v_issued;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.facility_attendance_qr_challenges(
    facility_id,token_hash,issued_at,expires_at,issued_by
  ) VALUES (
    p_facility_id,encode(extensions.digest(v_token,'sha256'),'hex'),
    v_issued,v_expires,auth.uid()
  );
  RETURN QUERY SELECT v_token,v_issued,v_expires;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_facility_attendance_qr(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_facility_attendance_qr(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_unified_attendance(
  p_target_type text,
  p_target_id uuid,
  p_action text,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_accuracy double precision DEFAULT NULL,
  p_qr_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.workers%ROWTYPE;
  v_staff public.facility_staff%ROWTYPE;
  v_app public.shift_applications%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_setting public.facility_attendance_settings%ROWTYPE;
  v_staff_att public.staff_attendances%ROWTYPE;
  v_shift_att public.shift_attendances%ROWTYPE;
  v_point public.geography;
  v_distance integer;
  v_accuracy integer;
  v_qr_hash text;
  v_qr_valid boolean := false;
  v_qr_exists boolean := false;
  v_qr_other_facility boolean := false;
  v_gps_valid boolean := false;
  v_method text := 'GPS';
  v_failure text;
  v_detail text;
  v_work_date date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_attendance_id uuid;
  v_late integer := 0;
  v_early integer := 0;
BEGIN
  IF p_target_type NOT IN ('staff','shift') OR p_action NOT IN ('check_in','check_out') THEN
    RETURN jsonb_build_object('ok',false,'reason','INVALID_STATE','message','출퇴근 요청 형식이 올바르지 않아요.');
  END IF;
  SELECT * INTO v_worker FROM public.workers WHERE auth_user_id=auth.uid() AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','NOT_ASSIGNED','message','연결된 근로자 계정을 찾지 못했어요.');
  END IF;

  IF p_target_type='staff' THEN
    SELECT * INTO v_staff FROM public.facility_staff
    WHERE id=p_target_id AND worker_id=v_worker.id AND status='active';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'reason','NOT_ASSIGNED','message','이 병원에 연결된 직원이 아니에요.');
    END IF;
    SELECT * INTO v_facility FROM public.facilities WHERE id=v_staff.facility_id;
    v_work_date := (timezone('Asia/Seoul',v_now))::date;
    IF v_staff.default_end_time<=v_staff.default_start_time
       AND (timezone('Asia/Seoul',v_now))::time<v_staff.default_end_time THEN
      v_work_date:=v_work_date-1;
    END IF;
    v_start_at:=(v_work_date+v_staff.default_start_time) AT TIME ZONE 'Asia/Seoul';
    v_end_at:=(v_work_date+v_staff.default_end_time+
      CASE WHEN v_staff.default_end_time<=v_staff.default_start_time THEN interval '1 day' ELSE interval '0' END
    ) AT TIME ZONE 'Asia/Seoul';
  ELSE
    SELECT * INTO v_app FROM public.shift_applications
    WHERE id=p_target_id AND worker_id=v_worker.id AND status IN ('accepted','completed');
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok',false,'reason','NOT_ASSIGNED','message','배정된 시프트에서만 출퇴근할 수 있어요.');
    END IF;
    SELECT * INTO v_shift FROM public.shifts WHERE id=v_app.shift_id;
    SELECT * INTO v_facility FROM public.facilities WHERE id=v_shift.facility_id;
    v_work_date:=v_shift.shift_date;
    v_start_at:=(v_shift.shift_date+v_shift.start_time) AT TIME ZONE 'Asia/Seoul';
    v_end_at:=(v_shift.shift_date+v_shift.end_time+
      CASE WHEN v_shift.is_overnight THEN interval '1 day' ELSE interval '0' END
    ) AT TIME ZONE 'Asia/Seoul';
  END IF;

  SELECT * INTO v_setting FROM public.facility_attendance_settings WHERE facility_id=v_facility.id;
  IF NOT FOUND THEN
    v_setting.authentication_mode:='gps_or_qr'; v_setting.gps_radius_meters:=30;
    v_setting.max_gps_accuracy_meters:=80; v_setting.qr_fallback_enabled:=true;
    v_setting.check_in_before_minutes:=60; v_setting.check_in_after_minutes:=60;
    v_setting.check_out_before_minutes:=60; v_setting.check_out_after_minutes:=120;
  END IF;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL
     AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180 THEN
    v_point:=public.ST_SetSRID(public.ST_MakePoint(p_lng,p_lat),4326)::public.geography;
    v_distance:=round(public.ST_Distance(v_facility.location,v_point))::integer;
    v_accuracy:=CASE WHEN p_accuracy IS NULL THEN NULL ELSE round(p_accuracy)::integer END;
    v_gps_valid:=v_distance<=v_setting.gps_radius_meters
      AND v_accuracy IS NOT NULL AND v_accuracy<=v_setting.max_gps_accuracy_meters;
  END IF;
  IF p_qr_token IS NOT NULL AND length(p_qr_token)>=32 THEN
    v_qr_hash:=encode(extensions.digest(p_qr_token,'sha256'),'hex');
    SELECT EXISTS(
      SELECT 1 FROM public.facility_attendance_qr_challenges
      WHERE token_hash=v_qr_hash
    ) INTO v_qr_exists;
    SELECT EXISTS(
      SELECT 1 FROM public.facility_attendance_qr_challenges
      WHERE token_hash=v_qr_hash AND facility_id=v_facility.id
        AND revoked_at IS NULL AND expires_at>v_now
    ) INTO v_qr_valid;
    SELECT EXISTS(
      SELECT 1 FROM public.facility_attendance_qr_challenges
      WHERE token_hash=v_qr_hash AND facility_id<>v_facility.id
        AND revoked_at IS NULL AND expires_at>v_now
    ) INTO v_qr_other_facility;
  END IF;

  IF v_setting.authentication_mode='admin' THEN
    v_failure:='ADMIN_REQUIRED'; v_method:='ADMIN';
  ELSIF v_setting.authentication_mode='gps' THEN
    v_method:='GPS';
    IF NOT v_gps_valid THEN
      IF v_qr_valid AND v_setting.qr_fallback_enabled THEN v_method:='QR_FALLBACK';
      ELSE
        v_failure:=CASE WHEN v_point IS NULL THEN 'GPS_ERROR'
          WHEN v_accuracy IS NULL OR v_accuracy>v_setting.max_gps_accuracy_meters THEN 'GPS_ACCURACY_LOW'
          ELSE 'OUT_OF_RANGE' END;
      END IF;
    END IF;
  ELSIF v_setting.authentication_mode='gps_qr' THEN
    v_method:='GPS_QR';
    IF NOT v_gps_valid THEN
      v_failure:=CASE WHEN v_point IS NULL THEN 'GPS_ERROR'
        WHEN v_accuracy IS NULL OR v_accuracy>v_setting.max_gps_accuracy_meters THEN 'GPS_ACCURACY_LOW'
        ELSE 'OUT_OF_RANGE' END;
    ELSIF NOT v_qr_valid THEN
      v_failure:=CASE WHEN v_qr_other_facility THEN 'HOSPITAL_MISMATCH'
        WHEN NOT v_qr_exists THEN 'QR_INVALID' ELSE 'QR_EXPIRED' END;
    END IF;
  ELSIF v_setting.authentication_mode='qr' THEN
    v_method:='QR';
    IF NOT v_qr_valid THEN
      v_failure:=CASE WHEN v_qr_other_facility THEN 'HOSPITAL_MISMATCH'
        WHEN NOT v_qr_exists THEN 'QR_INVALID' ELSE 'QR_EXPIRED' END;
    END IF;
  ELSE
    IF v_gps_valid THEN v_method:='GPS';
    ELSIF v_qr_valid AND v_setting.qr_fallback_enabled THEN v_method:='QR_FALLBACK';
    ELSE
      v_method:='QR_FALLBACK';
      v_failure:=CASE WHEN v_qr_other_facility THEN 'HOSPITAL_MISMATCH'
        WHEN v_point IS NOT NULL AND v_accuracy IS NOT NULL
          AND v_accuracy<=v_setting.max_gps_accuracy_meters THEN 'OUT_OF_RANGE'
        WHEN p_qr_token IS NOT NULL THEN 'QR_EXPIRED'
        ELSE 'GPS_ERROR' END;
    END IF;
  END IF;

  IF v_failure IS NULL THEN
    IF p_action='check_in' AND
       (v_now<v_start_at-v_setting.check_in_before_minutes*interval '1 minute'
        OR v_now>v_start_at+v_setting.check_in_after_minutes*interval '1 minute') THEN
      v_failure:='TIME_NOT_ALLOWED';
    ELSIF p_action='check_out' AND
       (v_now<v_end_at-v_setting.check_out_before_minutes*interval '1 minute'
        OR v_now>v_end_at+v_setting.check_out_after_minutes*interval '1 minute') THEN
      v_failure:='TIME_NOT_ALLOWED';
    END IF;
  END IF;

  IF v_failure IS NOT NULL THEN
    INSERT INTO public.attendance_auth_logs(
      user_id,worker_id,staff_id,application_id,facility_id,target_type,action,
      authentication_method,latitude,longitude,gps_accuracy_meters,distance_meters,
      qr_token_hash,result,failure_reason,detail
    ) VALUES (
      auth.uid(),v_worker.id,v_staff.id,v_app.id,v_facility.id,p_target_type,p_action,
      v_method,p_lat,p_lng,v_accuracy,v_distance,v_qr_hash,'FAIL',v_failure,v_detail
    );
    RETURN jsonb_build_object(
      'ok',false,'reason',v_failure,'distanceM',v_distance,'accuracyM',v_accuracy,
      'radiusM',v_setting.gps_radius_meters,
      'message',CASE v_failure
        WHEN 'OUT_OF_RANGE' THEN format('병원에서 %sm 떨어져 있어요. %sm 안에서 다시 시도해 주세요.',v_distance,v_setting.gps_radius_meters)
        WHEN 'GPS_ACCURACY_LOW' THEN '현재 위치 정확도가 낮아요. 잠시 후 다시 확인하거나 QR로 인증해 주세요.'
        WHEN 'QR_EXPIRED' THEN 'QR 코드가 만료되었습니다. 새 QR로 다시 시도해 주세요.'
        WHEN 'QR_INVALID' THEN '유효한 병원 QR을 먼저 스캔해 주세요.'
        WHEN 'HOSPITAL_MISMATCH' THEN 'GPS와 QR의 병원 인증 정보가 일치하지 않습니다.'
        WHEN 'TIME_NOT_ALLOWED' THEN '현재는 이 근무의 출퇴근 가능 시간이 아니에요.'
        WHEN 'ADMIN_REQUIRED' THEN '이 병원은 관리자 승인 방식으로 운영 중이에요.'
        ELSE '현재 위치를 정확하게 확인할 수 없습니다.'
      END
    );
  END IF;

  v_late:=GREATEST(0,floor(extract(epoch FROM (v_now-v_start_at))/60)::integer);
  v_early:=GREATEST(0,floor(extract(epoch FROM (v_end_at-v_now))/60)::integer);

  IF p_target_type='staff' THEN
    SELECT * INTO v_staff_att FROM public.staff_attendances
    WHERE staff_id=v_staff.id AND work_date=v_work_date FOR UPDATE;
    IF p_action='check_in' THEN
      IF FOUND AND v_staff_att.check_in_at IS NOT NULL THEN v_failure:='DUPLICATE_ATTENDANCE';
      ELSE
        INSERT INTO public.staff_attendances(
          facility_id,staff_id,work_date,scheduled_start,scheduled_end,
          check_in_at,check_in_location,check_in_method,check_in_distance_m,
          check_in_gps_accuracy_m,check_in_status,late_minutes,status,note
        ) VALUES (
          v_facility.id,v_staff.id,v_work_date,v_staff.default_start_time,v_staff.default_end_time,
          v_now,v_point,v_method,v_distance,v_accuracy,'SUCCESS',v_late,
          CASE WHEN v_late>0 THEN 'late' ELSE 'working' END,'통합 근태 인증'
        ) ON CONFLICT(staff_id,work_date) DO UPDATE SET
          check_in_at=EXCLUDED.check_in_at,check_in_location=EXCLUDED.check_in_location,
          check_in_method=EXCLUDED.check_in_method,check_in_distance_m=EXCLUDED.check_in_distance_m,
          check_in_gps_accuracy_m=EXCLUDED.check_in_gps_accuracy_m,check_in_status='SUCCESS',
          late_minutes=EXCLUDED.late_minutes,status=EXCLUDED.status,updated_at=v_now
        RETURNING id INTO v_attendance_id;
      END IF;
    ELSE
      IF NOT FOUND OR v_staff_att.check_in_at IS NULL THEN v_failure:='INVALID_STATE';
      ELSIF v_staff_att.check_out_at IS NOT NULL THEN v_failure:='DUPLICATE_ATTENDANCE';
      ELSE
        UPDATE public.staff_attendances SET
          check_out_at=v_now,check_out_location=v_point,check_out_method=v_method,
          check_out_distance_m=v_distance,check_out_gps_accuracy_m=v_accuracy,
          check_out_status='SUCCESS',early_leave_minutes=v_early,status='completed',updated_at=v_now
        WHERE id=v_staff_att.id RETURNING id INTO v_attendance_id;
      END IF;
    END IF;
  ELSE
    SELECT * INTO v_shift_att FROM public.shift_attendances
    WHERE application_id=v_app.id FOR UPDATE;
    IF p_action='check_in' THEN
      IF FOUND AND v_shift_att.check_in_at IS NOT NULL THEN v_failure:='DUPLICATE_ATTENDANCE';
      ELSE
        INSERT INTO public.shift_attendances(
          shift_id,worker_id,application_id,check_in_at,check_in_location,
          check_in_distance_m,check_in_method,check_in_gps_accuracy_m,
          check_in_status,late_minutes
        ) VALUES (
          v_shift.id,v_worker.id,v_app.id,v_now,v_point,v_distance,v_method,v_accuracy,'SUCCESS',v_late
        ) RETURNING id INTO v_attendance_id;
        UPDATE public.shift_applications SET checked_in_at=v_now WHERE id=v_app.id;
        UPDATE public.shifts SET status='in_progress',updated_at=v_now WHERE id=v_shift.id;
      END IF;
    ELSE
      IF NOT FOUND OR v_shift_att.check_in_at IS NULL THEN v_failure:='INVALID_STATE';
      ELSIF v_shift_att.check_out_at IS NOT NULL THEN v_failure:='DUPLICATE_ATTENDANCE';
      ELSE
        UPDATE public.shift_attendances SET
          check_out_at=v_now,check_out_location=v_point,check_out_distance_m=v_distance,
          check_out_method=v_method,check_out_gps_accuracy_m=v_accuracy,
          check_out_status='SUCCESS',early_leave_minutes=v_early,updated_at=v_now
        WHERE id=v_shift_att.id RETURNING id INTO v_attendance_id;
        UPDATE public.shift_applications SET checked_out_at=v_now,status='completed' WHERE id=v_app.id;
        UPDATE public.shifts SET status='completed',updated_at=v_now WHERE id=v_shift.id;
      END IF;
    END IF;
  END IF;

  IF v_failure IS NOT NULL THEN
    INSERT INTO public.attendance_auth_logs(
      user_id,worker_id,staff_id,application_id,facility_id,target_type,action,
      authentication_method,latitude,longitude,gps_accuracy_meters,distance_meters,
      qr_token_hash,result,failure_reason
    ) VALUES (
      auth.uid(),v_worker.id,v_staff.id,v_app.id,v_facility.id,p_target_type,p_action,
      v_method,p_lat,p_lng,v_accuracy,v_distance,v_qr_hash,'FAIL',v_failure
    );
    RETURN jsonb_build_object('ok',false,'reason',v_failure,'message',
      CASE WHEN v_failure='DUPLICATE_ATTENDANCE' THEN '이미 처리된 출퇴근 기록이에요.'
           ELSE '출근 기록이 없어 퇴근할 수 없어요.' END);
  END IF;

  INSERT INTO public.attendance_auth_logs(
    user_id,worker_id,staff_id,application_id,facility_id,
    staff_attendance_id,shift_attendance_id,target_type,action,
    authentication_method,latitude,longitude,gps_accuracy_meters,distance_meters,
    qr_token_hash,result
  ) VALUES (
    auth.uid(),v_worker.id,v_staff.id,v_app.id,v_facility.id,
    CASE WHEN p_target_type='staff' THEN v_attendance_id END,
    CASE WHEN p_target_type='shift' THEN v_attendance_id END,
    p_target_type,p_action,v_method,p_lat,p_lng,v_accuracy,v_distance,v_qr_hash,'SUCCESS'
  );
  RETURN jsonb_build_object(
    'ok',true,'action',p_action,'method',v_method,'distanceM',v_distance,
    'accuracyM',v_accuracy,'attendanceId',v_attendance_id,'facilityName',v_facility.name,
    'checkInAt',CASE WHEN p_action='check_in' THEN v_now ELSE COALESCE(v_staff_att.check_in_at,v_shift_att.check_in_at) END,
    'checkOutAt',CASE WHEN p_action='check_out' THEN v_now END,
    'lateMinutes',v_late,'earlyLeaveMinutes',v_early
  );
END;
$$;
REVOKE ALL ON FUNCTION public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text) TO authenticated;

-- Every checkout path (GPS, QR or admin) feeds the same wage calculation.
CREATE OR REPLACE FUNCTION public.sync_shift_checkout_to_payroll()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shift public.shifts%ROWTYPE;
  v_facility public.facilities%ROWTYPE;
  v_wage jsonb;
  v_bank_id uuid;
  v_wage_id uuid;
  v_gross integer;
BEGIN
  IF OLD.check_out_at IS NOT NULL OR NEW.check_out_at IS NULL OR NEW.check_in_at IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id=NEW.shift_id;
  SELECT * INTO v_facility FROM public.facilities WHERE id=v_shift.facility_id;
  v_wage:=public.calculate_shift_wage_secure(
    NEW.check_in_at,NEW.check_out_at,v_shift.hourly_wage,
    COALESCE(v_facility.is_5plus,false),v_shift.is_holiday
  );
  v_gross:=(v_wage->>'gross')::integer;
  INSERT INTO public.wage_calculations(
    attendance_id,org_id,worker_id,shift_id,rule_version,worked_minutes,
    night_minutes,overtime_minutes,break_minutes,base,overtime_premium,
    night_premium,holiday_premium,gross,breakdown,calculated_at
  ) VALUES (
    NEW.id,v_shift.facility_id,NEW.worker_id,v_shift.id,v_wage->>'ruleVersion',
    (v_wage->>'workedMinutes')::integer,(v_wage->>'nightMinutes')::integer,
    (v_wage->>'overtimeMinutes')::integer,(v_wage->>'breakMinutes')::integer,
    (v_wage->>'base')::integer,(v_wage->>'overtimePremium')::integer,
    (v_wage->>'nightPremium')::integer,(v_wage->>'holidayPremium')::integer,
    v_gross,v_wage,NEW.check_out_at
  ) ON CONFLICT(attendance_id) DO UPDATE SET
    worked_minutes=EXCLUDED.worked_minutes,night_minutes=EXCLUDED.night_minutes,
    overtime_minutes=EXCLUDED.overtime_minutes,break_minutes=EXCLUDED.break_minutes,
    base=EXCLUDED.base,overtime_premium=EXCLUDED.overtime_premium,
    night_premium=EXCLUDED.night_premium,holiday_premium=EXCLUDED.holiday_premium,
    gross=EXCLUDED.gross,breakdown=EXCLUDED.breakdown,calculated_at=EXCLUDED.calculated_at
  RETURNING id INTO v_wage_id;
  SELECT id INTO v_bank_id FROM public.worker_bank_accounts
  WHERE worker_id=NEW.worker_id AND is_primary=true AND deleted_at IS NULL
  ORDER BY created_at DESC LIMIT 1;
  IF v_bank_id IS NOT NULL THEN
    INSERT INTO public.wage_payment_instructions(
      facility_id,worker_id,shift_id,attendance_id,wage_calculation_id,
      bank_account_id,gross_amount,deduction_status,net_amount,due_date,
      bank_name_snapshot,account_last4_snapshot
    ) VALUES (
      v_shift.facility_id,NEW.worker_id,v_shift.id,NEW.id,v_wage_id,
      v_bank_id,v_gross,'unconfirmed',v_gross,v_shift.shift_date+7,
      (SELECT bank_name FROM public.worker_bank_accounts WHERE id=v_bank_id),
      (SELECT account_number_last4 FROM public.worker_bank_accounts WHERE id=v_bank_id)
    ) ON CONFLICT(attendance_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_shift_checkout_to_payroll ON public.shift_attendances;
CREATE TRIGGER trg_sync_shift_checkout_to_payroll
  AFTER UPDATE OF check_out_at ON public.shift_attendances
  FOR EACH ROW EXECUTE FUNCTION public.sync_shift_checkout_to_payroll();
REVOKE ALL ON FUNCTION public.sync_shift_checkout_to_payroll() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE VIEW public.unified_attendance_dashboard
WITH (security_invoker=true)
AS
SELECT
  'staff'::text AS target_type,sa.id AS attendance_id,fs.facility_id,
  fs.id AS employee_id,NULL::uuid AS application_id,NULL::uuid AS shift_id,
  fs.name,fs.engagement_type,fs.role,fs.department,sa.work_date,
  sa.scheduled_start,sa.scheduled_end,sa.check_in_at,sa.check_out_at,
  sa.check_in_method,sa.check_out_method,sa.check_in_distance_m,sa.check_out_distance_m,
  sa.check_in_gps_accuracy_m,sa.check_out_gps_accuracy_m,sa.late_minutes,
  sa.early_leave_minutes,sa.status,sa.approved_by,sa.approved_at
FROM public.staff_attendances sa
JOIN public.facility_staff fs ON fs.id=sa.staff_id
UNION ALL
SELECT
  'shift',att.id,s.facility_id,NULL,a.id,s.id,w.name,'daily',w.role,s.department,s.shift_date,
  s.start_time,s.end_time,att.check_in_at,att.check_out_at,
  att.check_in_method,att.check_out_method,att.check_in_distance_m,att.check_out_distance_m,
  att.check_in_gps_accuracy_m,att.check_out_gps_accuracy_m,att.late_minutes,
  att.early_leave_minutes,
  CASE WHEN att.check_out_at IS NOT NULL THEN 'completed'
       WHEN att.check_in_at IS NOT NULL THEN 'working' ELSE 'scheduled' END,
  att.manual_override_by,att.approved_at
FROM public.shift_attendances att
JOIN public.shift_applications a ON a.id=att.application_id
JOIN public.shifts s ON s.id=att.shift_id
JOIN public.workers w ON w.id=att.worker_id;
GRANT SELECT ON public.unified_attendance_dashboard TO authenticated;
