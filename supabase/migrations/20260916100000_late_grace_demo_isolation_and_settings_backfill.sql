-- 2026-09-16 근태 검토 수정
-- ① 지각 유예(기본 20분)를 시설별 설정으로 추가 — 유예 안이면 late_minutes 0 = 정상 출근
-- ② 시설유형별 인증 기본값을 기존 사업장에도 백필 (트리거가 AFTER INSERT 전용이라 신규만 받았음)
-- ③ 단기 워커 조기퇴근 승인·반려 결과를 워커에게 푸시 (기존에는 audit_logs만 남고 통보 없음)
-- ④ 미출근 관리자 알림에서 데모 사업장 제외 + 자정 넘김 시간창 오류 수정

-- ---------------------------------------------------------------------------
-- ① 지각 유예 설정
-- ---------------------------------------------------------------------------
ALTER TABLE public.facility_attendance_settings
  ADD COLUMN IF NOT EXISTS late_grace_minutes smallint NOT NULL DEFAULT 20;
ALTER TABLE public.facility_attendance_settings DROP CONSTRAINT IF EXISTS facility_attendance_settings_late_grace_minutes_check;
ALTER TABLE public.facility_attendance_settings ADD CONSTRAINT facility_attendance_settings_late_grace_minutes_check
  CHECK (late_grace_minutes BETWEEN 0 AND 120);
COMMENT ON COLUMN public.facility_attendance_settings.late_grace_minutes IS '예정 출근시각 이후 이 분수까지는 지각으로 세지 않는다 (기본 20분)';

-- ---------------------------------------------------------------------------
-- ② 시설유형별 인증 기본값 백필
--    관리자가 직접 저장한 적 없는 행(updated_by IS NULL)만 손댄다. 사람이 고른 반경은 건드리지 않는다.
-- ---------------------------------------------------------------------------
INSERT INTO public.facility_attendance_settings
  (facility_id, authentication_mode, gps_radius_meters, max_gps_accuracy_meters, qr_fallback_enabled)
SELECT f.id, 'gps_or_qr',
       CASE WHEN f.facility_type IN ('care_hospital','general_hospital','nursing_home') THEN 100 ELSE 30 END,
       CASE WHEN f.facility_type IN ('care_hospital','general_hospital','nursing_home') THEN 150 ELSE 80 END,
       true
FROM public.facilities f
WHERE f.deleted_at IS NULL
ON CONFLICT (facility_id) DO NOTHING;

UPDATE public.facility_attendance_settings s
SET gps_radius_meters = 100, max_gps_accuracy_meters = 150, updated_at = now()
FROM public.facilities f
WHERE f.id = s.facility_id
  AND f.deleted_at IS NULL
  AND f.facility_type IN ('care_hospital','general_hospital','nursing_home')
  AND s.updated_by IS NULL
  AND s.gps_radius_meters = 30
  AND s.max_gps_accuracy_meters = 80;

-- ---------------------------------------------------------------------------
-- ③ 지각 유예를 반영한 통합 근태 인증
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_unified_attendance(p_target_type text, p_target_id uuid, p_action text, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_accuracy double precision DEFAULT NULL::double precision, p_qr_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_ip text;
  v_ip_valid boolean := false;
  v_gps_valid boolean := false;
  v_method text := 'GPS';
  v_failure text;
  v_detail text;
  v_work_date date;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_attendance_id uuid;
  v_grace integer := 20;   -- 시설별 지각 유예(분)
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
      RETURN jsonb_build_object('ok',false,'reason','NOT_ASSIGNED','message','이 사업장에 연결된 직원이 아니에요.');
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
    v_setting.authentication_mode:='gps'; v_setting.gps_radius_meters:=30;
    v_setting.max_gps_accuracy_meters:=80; v_setting.qr_fallback_enabled:=true;
    v_setting.check_in_before_minutes:=60; v_setting.check_in_after_minutes:=60;
    v_setting.check_out_before_minutes:=60; v_setting.check_out_after_minutes:=120;
    v_setting.late_grace_minutes:=20;
  END IF;
  v_grace:=GREATEST(0,COALESCE(v_setting.late_grace_minutes,20));

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

  v_ip := NULLIF(trim(split_part(COALESCE(
    (current_setting('request.headers', true))::json->>'x-forwarded-for',
    (current_setting('request.headers', true))::json->>'x-real-ip',
    ''), ',', 1)), '');
  v_ip_valid := v_ip IS NOT NULL AND v_setting.allowed_ips IS NOT NULL
    AND v_ip = ANY(v_setting.allowed_ips);

  IF v_setting.authentication_mode='network' THEN
    v_method:='WORKPLACE_NET';
    IF NOT v_ip_valid THEN v_failure:='NETWORK_NOT_ALLOWED'; END IF;
  ELSIF v_setting.authentication_mode='admin' THEN
    v_failure:='ADMIN_REQUIRED'; v_method:='ADMIN';
  ELSIF v_setting.authentication_mode='gps' THEN
    v_method:='GPS';
    IF NOT v_gps_valid THEN
      IF v_qr_valid AND v_setting.qr_fallback_enabled THEN v_method:='QR_FALLBACK';
      ELSIF v_ip_valid THEN v_method:='WORKPLACE_NET';
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
    ELSIF v_ip_valid THEN v_method:='WORKPLACE_NET';
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
        WHEN 'OUT_OF_RANGE' THEN format('사업장에서 %sm 떨어져 있어요. %sm 안에서 다시 시도해 주세요.',v_distance,v_setting.gps_radius_meters)
        WHEN 'GPS_ACCURACY_LOW' THEN '현재 위치 정확도가 낮아요. 잠시 후 다시 확인하거나 QR로 인증해 주세요.'
        WHEN 'QR_EXPIRED' THEN 'QR 코드가 만료되었습니다. 새 QR로 다시 시도해 주세요.'
        WHEN 'QR_INVALID' THEN '유효한 사업장 QR을 먼저 스캔해 주세요.'
        WHEN 'HOSPITAL_MISMATCH' THEN 'GPS와 QR의 사업장 인증 정보가 일치하지 않습니다.'
        WHEN 'TIME_NOT_ALLOWED' THEN CASE WHEN p_action='check_in'
          THEN format('출근 가능 시간은 %s~%s예요. 그 밖의 시간은 관리자에게 수동 기록을 요청해 주세요.',
                      to_char(timezone('Asia/Seoul', v_start_at - v_setting.check_in_before_minutes*interval '1 minute'),'HH24:MI'),
                      to_char(timezone('Asia/Seoul', v_start_at + v_setting.check_in_after_minutes*interval '1 minute'),'HH24:MI'))
          ELSE format('퇴근 가능 시간은 %s~%s예요. 그 밖의 시간은 관리자에게 수동 기록을 요청해 주세요.',
                      to_char(timezone('Asia/Seoul', v_end_at - v_setting.check_out_before_minutes*interval '1 minute'),'HH24:MI'),
                      to_char(timezone('Asia/Seoul', v_end_at + v_setting.check_out_after_minutes*interval '1 minute'),'HH24:MI')) END
        WHEN 'NETWORK_NOT_ALLOWED' THEN '등록된 사업장 Wi-Fi에 연결한 뒤 다시 시도해 주세요.'
        WHEN 'ADMIN_REQUIRED' THEN '이 사업장은 관리자 승인 방식으로 운영 중이에요.'
        ELSE '현재 위치를 정확하게 확인할 수 없습니다.'
      END
    );
  END IF;

  -- 지각은 시설별 유예(기본 20분)를 넘긴 분부터 센다. 유예 안이면 0분 = 정상 출근
  v_late:=GREATEST(0,floor(extract(epoch FROM (v_now-v_start_at))/60)::integer - v_grace);
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
      ELSIF v_staff_att.check_out_at IS NOT NULL OR v_staff_att.checkout_requested_at IS NOT NULL THEN v_failure:='DUPLICATE_ATTENDANCE';
      ELSE
        IF v_early>0 THEN
          UPDATE public.staff_attendances SET
            checkout_requested_at=v_now,check_out_location=v_point,check_out_method=v_method,
            check_out_distance_m=v_distance,check_out_gps_accuracy_m=v_accuracy,
            check_out_status='SUCCESS',early_leave_minutes=v_early,status='checkout_pending',updated_at=v_now
          WHERE id=v_staff_att.id RETURNING id INTO v_attendance_id;
        ELSE
          UPDATE public.staff_attendances SET
            check_out_at=v_now,checkout_requested_at=v_now,check_out_location=v_point,check_out_method=v_method,
            check_out_distance_m=v_distance,check_out_gps_accuracy_m=v_accuracy,
            check_out_status='SUCCESS',early_leave_minutes=0,status='completed',updated_at=v_now
          WHERE id=v_staff_att.id RETURNING id INTO v_attendance_id;
        END IF;
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
      ELSIF v_shift_att.check_out_at IS NOT NULL OR v_shift_att.checkout_requested_at IS NOT NULL THEN v_failure:='DUPLICATE_ATTENDANCE';
      ELSE
        IF v_early>0 THEN
          UPDATE public.shift_attendances SET
            checkout_requested_at=v_now,check_out_location=v_point,check_out_distance_m=v_distance,
            check_out_method=v_method,check_out_gps_accuracy_m=v_accuracy,
            check_out_status='SUCCESS',early_leave_minutes=v_early,updated_at=v_now
          WHERE id=v_shift_att.id RETURNING id INTO v_attendance_id;
        ELSE
          UPDATE public.shift_attendances SET
            check_out_at=v_now,checkout_requested_at=v_now,check_out_location=v_point,check_out_distance_m=v_distance,
            check_out_method=v_method,check_out_gps_accuracy_m=v_accuracy,
            check_out_status='SUCCESS',early_leave_minutes=0,updated_at=v_now
          WHERE id=v_shift_att.id RETURNING id INTO v_attendance_id;
          UPDATE public.shift_applications SET checked_out_at=v_now,status='completed' WHERE id=v_app.id;
          UPDATE public.shifts SET status='completed',updated_at=v_now WHERE id=v_shift.id;
        END IF;
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
    'ok',true,'status',CASE WHEN p_action='check_out' AND v_early>0 THEN 'pending' ELSE 'approved' END,'action',p_action,'method',v_method,'distanceM',v_distance,
    'accuracyM',v_accuracy,'attendanceId',v_attendance_id,'facilityName',v_facility.name,
    'checkInAt',CASE WHEN p_action='check_in' THEN v_now ELSE COALESCE(v_staff_att.check_in_at,v_shift_att.check_in_at) END,
    'checkOutAt',CASE WHEN p_action='check_out' AND v_early=0 THEN v_now END,
    'lateMinutes',v_late,'earlyLeaveMinutes',v_early
  );
END;
$function$
;
-- ---------------------------------------------------------------------------
-- ④ 단기 워커 조기퇴근 결정 통보
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_shift_early_checkout(
  p_application_id uuid,
  p_decision text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_app public.shift_applications%ROWTYPE;
  v_shift public.shifts%ROWTYPE;
  v_att public.shift_attendances%ROWTYPE;
  v_worker_auth uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION '승인 여부가 올바르지 않아요';
  END IF;
  SELECT * INTO v_app FROM public.shift_applications
  WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND OR v_app.status<>'accepted' THEN
    RAISE EXCEPTION '처리할 확정 근무를 찾지 못했어요';
  END IF;
  SELECT * INTO v_shift FROM public.shifts WHERE id=v_app.shift_id;
  IF public.can_manage_facility(v_shift.facility_id,ARRAY['owner','operator','super']::text[]) IS DISTINCT FROM true THEN
    RAISE EXCEPTION '이 사업장의 근태를 처리할 권한이 없어요';
  END IF;
  SELECT * INTO v_att FROM public.shift_attendances
  WHERE application_id=p_application_id FOR UPDATE;
  IF NOT FOUND OR v_att.check_in_at IS NULL OR v_att.check_out_at IS NOT NULL
     OR v_att.checkout_requested_at IS NULL THEN
    RAISE EXCEPTION '처리할 조기 퇴근 요청이 없어요';
  END IF;

  IF p_decision='approved' THEN
    UPDATE public.shift_attendances SET
      check_out_at=v_att.checkout_requested_at,
      approved_at=v_now,
      manual_override_by=auth.uid(),
      manual_override_reason='관리자 조기 퇴근 승인',
      updated_at=v_now
    WHERE id=v_att.id;
    UPDATE public.shift_applications SET
      checked_out_at=v_att.checkout_requested_at,status='completed'
    WHERE id=v_app.id;
    UPDATE public.shifts SET status='completed',updated_at=v_now WHERE id=v_shift.id;
  ELSE
    UPDATE public.shift_attendances SET
      checkout_requested_at=NULL,
      check_out_location=NULL,check_out_distance_m=NULL,check_out_method=NULL,
      check_out_gps_accuracy_m=NULL,check_out_status=NULL,early_leave_minutes=0,
      manual_override_by=auth.uid(),manual_override_reason='관리자 조기 퇴근 반려',
      updated_at=v_now
    WHERE id=v_att.id;
  END IF;

  -- 결정 결과를 단기 워커에게 알린다. 워커 화면은 새로고침 전까지 '승인 대기 중'이라 푸시가 유일한 신호
  SELECT w.auth_user_id INTO v_worker_auth FROM public.workers w WHERE w.id=v_app.worker_id;
  IF v_worker_auth IS NOT NULL THEN
    INSERT INTO public.notification_outbox(worker_auth_user_id,event_type,dedupe_key,title,body,data)
    VALUES(
      v_worker_auth,'attendance.shift_checkout_decided',
      'attendance.shift_checkout_decided:'||v_att.id||':'||p_decision||':'||extract(epoch FROM v_att.checkout_requested_at)::bigint,
      CASE WHEN p_decision='approved' THEN '조기 퇴근이 승인됐어요' ELSE '조기 퇴근 요청이 반려됐어요' END,
      CASE WHEN p_decision='approved' THEN '요청한 시각으로 퇴근이 확정됐어요. 근무시간이 반영됩니다.'
           ELSE '관리자가 반려했어요. 근무를 이어가고 예정 시간에 다시 퇴근을 눌러 주세요.' END,
      jsonb_build_object('url','/workplace','kind','attendance.shift_checkout_decided','decision',p_decision)
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;

  INSERT INTO public.audit_logs(actor_type,actor_id,action,entity_type,entity_id,before_data,after_data)
  VALUES('facility',auth.uid(),'attendance.shift_early_checkout.'||p_decision,
    'shift_attendance',v_att.id,
    jsonb_build_object('checkout_requested_at',v_att.checkout_requested_at,'early_leave_minutes',v_att.early_leave_minutes),
    jsonb_build_object('decision',p_decision,'decided_at',v_now));
  RETURN jsonb_build_object('ok',true,'decision',p_decision,'attendanceId',v_att.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.decide_shift_early_checkout(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_shift_early_checkout(uuid,text) TO authenticated;REVOKE ALL ON FUNCTION public.decide_shift_early_checkout(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_shift_early_checkout(uuid,text) TO authenticated;

-- ---------------------------------------------------------------------------
-- ⑤ 미출근 관리자 알림: 데모 사업장 제외 + 자정 넘김 시간창 수정 + 시설 유예 반영
--    이전 판은 default_start_time 을 ::time 으로 잘라 비교해 자정 근처에서 창이 뒤집혔고,
--    데모 사업장 직원까지 실제 관리자에게 알림이 나갔다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_no_show_admin_alerts(p_grace_minutes integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_now timestamp := timezone('Asia/Seoul', now());
  v_today date := (timezone('Asia/Seoul', now()))::date;
  v_count integer := 0;
BEGIN
  WITH late_staff AS (
    SELECT s.id AS staff_id, s.name, s.facility_id, f.name AS facility_name, s.default_start_time
    FROM public.facility_staff s
    JOIN public.facilities f ON f.id = s.facility_id AND f.is_active = true AND f.deleted_at IS NULL
      AND COALESCE(f.is_demo, false) = false
    LEFT JOIN public.facility_attendance_settings fas ON fas.facility_id = s.facility_id
    CROSS JOIN LATERAL (SELECT GREATEST(p_grace_minutes, COALESCE(fas.late_grace_minutes, 20)) AS mins) g
    WHERE s.status = 'active' AND s.default_start_time IS NOT NULL
      -- date + time 으로 타임스탬프를 만들어 비교한다 (::time 비교는 자정을 넘길 때 창이 뒤집힌다)
      AND (v_today + s.default_start_time) <= v_now - make_interval(mins => g.mins)
      AND (v_today + s.default_start_time) >  v_now - make_interval(mins => g.mins + 15)   -- 최근 15분 창만 (재실행 시 중복은 dedupe)
      AND (s.work_weekdays IS NULL OR cardinality(s.work_weekdays) = 0 OR extract(isodow FROM v_today)::smallint = ANY (s.work_weekdays))
      AND (s.contract_start IS NULL OR s.contract_start <= v_today)
      AND (s.contract_end IS NULL OR s.contract_end >= v_today)
      AND NOT EXISTS (SELECT 1 FROM public.staff_attendances a WHERE a.staff_id = s.id AND a.work_date = v_today AND (a.check_in_at IS NOT NULL OR a.status IN ('absent','leave')))
      AND NOT EXISTS (SELECT 1 FROM public.staff_leave_requests l WHERE l.staff_id = s.id AND l.status = 'approved' AND v_today BETWEEN l.start_date AND l.end_date)
  ), recipients AS (
    SELECT ls.*, u.user_id
    FROM late_staff ls
    JOIN LATERAL (
      SELECT f.admin_user_id AS user_id FROM public.facilities f WHERE f.id = ls.facility_id AND f.admin_user_id IS NOT NULL
      UNION
      SELECT a.user_id FROM public.facility_admin_access a WHERE a.facility_id = ls.facility_id AND a.access_role IN ('owner','operator','super')
    ) u ON true
  ), ins AS (
    INSERT INTO public.notification_outbox (worker_auth_user_id, event_type, dedupe_key, title, body, data)
    SELECT r.user_id, 'attendance.no_show',
           'attendance.no_show:' || r.staff_id || ':' || v_today || ':' || r.user_id,
           r.name || ' 미출근 확인이 필요해요',
           r.facility_name || ' ' || to_char(r.default_start_time, 'HH24:MI') || ' 출근 예정인데 아직 기록이 없어요. 연락해 보거나 결근·출근을 직접 처리해 주세요.',
           jsonb_build_object('url', '/timesheet', 'kind', 'attendance.no_show', 'staff_id', r.staff_id, 'facility_id', r.facility_id)
    FROM recipients r
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_no_show_admin_alerts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_no_show_admin_alerts(integer) TO service_role;

-- 이미 쌓인 데모 미출근 알림은 발송 전에 폐기한다
UPDATE public.notification_outbox o
SET status = 'discarded', last_error = 'demo facility (2026-09-16 backfill)'
WHERE o.event_type = 'attendance.no_show'
  AND o.status IN ('pending','failed')
  AND EXISTS (
    SELECT 1 FROM public.facilities f
    WHERE f.id = (o.data->>'facility_id')::uuid AND COALESCE(f.is_demo, false) = true
  );

SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='facility_attendance_settings' AND column_name='late_grace_minutes') AS late_grace_col_1,
       (SELECT count(*) FROM public.facility_attendance_settings s JOIN public.facilities f ON f.id=s.facility_id
         WHERE f.facility_type IN ('care_hospital','general_hospital','nursing_home') AND s.updated_by IS NULL AND s.gps_radius_meters < 100) AS hospital_unedited_small_radius_0,
       (SELECT count(*) FROM pg_proc WHERE proname IN ('enqueue_no_show_admin_alerts','record_unified_attendance','decide_shift_early_checkout')) AS fns_3;
