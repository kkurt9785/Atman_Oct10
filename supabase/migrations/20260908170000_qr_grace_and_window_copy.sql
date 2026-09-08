-- 동적 QR 유예시간 + 출퇴근 가능시간 안내 + 단기 시프트 조기퇴근 승인 통합.
-- 화면은 60초마다 교체하되 토큰은 5분간 유효(스캔→로그인→GPS→전송 여유). 이전 토큰은 폐기하지 않고 자연 만료.

ALTER TABLE public.shift_attendances
  ADD COLUMN IF NOT EXISTS checkout_requested_at timestamptz;

CREATE OR REPLACE FUNCTION public.issue_facility_attendance_qr(p_facility_id uuid)
 RETURNS TABLE(token text, issued_at timestamp with time zone, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_token text;
  v_issued timestamptz := clock_timestamp();
  v_expires timestamptz := v_issued + interval '5 minutes'; -- 화면 회전은 60초, 토큰 유효는 5분: 카메라 스캔→(로그인)→GPS→전송까지의 여유
BEGIN
  IF public.can_manage_facility(p_facility_id, ARRAY['owner','operator','super']::text[]) IS DISTINCT FROM true THEN
    RAISE EXCEPTION '동적 QR을 표시할 권한이 없어요';
  END IF;
  -- 이전 토큰은 폐기하지 않고 5분에 자연 만료시킨다.
  DELETE FROM public.facility_attendance_qr_challenges AS challenge
  WHERE challenge.facility_id = p_facility_id AND challenge.expires_at < v_issued - interval '1 day';
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.facility_attendance_qr_challenges(
    facility_id,token_hash,issued_at,expires_at,issued_by
  ) VALUES (
    p_facility_id,encode(extensions.digest(v_token,'sha256'),'hex'),
    v_issued,v_expires,auth.uid()
  );
  RETURN QUERY SELECT v_token,v_issued,v_expires;
END;
$function$
;

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

  INSERT INTO public.audit_logs(actor_type,actor_id,action,entity_type,entity_id,before_data,after_data)
  VALUES('facility',auth.uid(),'attendance.shift_early_checkout.'||p_decision,
    'shift_attendance',v_att.id,
    jsonb_build_object('checkout_requested_at',v_att.checkout_requested_at,'early_leave_minutes',v_att.early_leave_minutes),
    jsonb_build_object('decision',p_decision,'decided_at',v_now));
  RETURN jsonb_build_object('ok',true,'decision',p_decision,'attendanceId',v_att.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.decide_shift_early_checkout(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_shift_early_checkout(uuid,text) TO authenticated;

SELECT (SELECT count(*) FROM pg_proc WHERE proname IN ('issue_facility_attendance_qr','record_unified_attendance','decide_shift_early_checkout')) AS fns_3,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='shift_attendances' AND column_name='checkout_requested_at') AS checkout_request_col_1;
