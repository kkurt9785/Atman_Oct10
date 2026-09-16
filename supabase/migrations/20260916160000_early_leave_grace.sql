-- 조퇴 유예(early_leave_grace_minutes) 신설 — 시설별 설정
--
-- 배경: 조퇴 유예가 없어서 예정 퇴근 1분 전에 눌러도 status='checkout_pending' 으로 빠졌다.
-- 급여 집계(lib/db/payroll.ts)는 status='completed' + check_out_at 있는 행만 세므로,
-- 관리자가 승인을 잊으면 그 근무는 0분으로 잡힌다. 실무에서 조퇴 대부분은
-- "맡은 일이 예정보다 일찍 끝나서 나가는" 경우라 매번 승인을 거치게 할 이유가 없다.
--
-- 기본값 10분 — 지각 20분보다 짧게 잡았다. 지각은 교통이 변수지만 조퇴는 본인 재량이라
-- 같은 20분을 주면 상시 조기퇴근 관행이 된다. 인수인계 끝나면 나가는 현장은 시설에서 올리면 된다.
-- 0 으로 두면 종전과 똑같이 1분만 일찍 눌러도 승인 대기로 간다.
--
-- ⚠️ 유예 안에 들어오면 early_leave_minutes 가 0 으로 기록돼 급여는 만근으로 집계된다.
--    지각 유예가 19분 늦어도 만근인 것과 같은 성질이다. 이걸 원치 않는 사업장은 0분으로 설정.

-- ---------------------------------------------------------------------------
-- ① 컬럼 추가. 기존 행은 NOT NULL DEFAULT 로 전부 10 이 채워진다(별도 백필 불필요)
-- ---------------------------------------------------------------------------
ALTER TABLE public.facility_attendance_settings
  ADD COLUMN IF NOT EXISTS early_leave_grace_minutes smallint NOT NULL DEFAULT 10;

ALTER TABLE public.facility_attendance_settings
  DROP CONSTRAINT IF EXISTS facility_attendance_settings_early_leave_grace_minutes_check;
ALTER TABLE public.facility_attendance_settings
  ADD CONSTRAINT facility_attendance_settings_early_leave_grace_minutes_check
  CHECK (early_leave_grace_minutes BETWEEN 0 AND 120);

COMMENT ON COLUMN public.facility_attendance_settings.early_leave_grace_minutes IS
  '예정 퇴근시각 이전 이 분수까지는 조퇴로 세지 않고 바로 퇴근 확정한다 (기본 10분)';

-- ---------------------------------------------------------------------------
-- ② record_unified_attendance — 조퇴 계산에 유예 반영
--    20260916100000 버전에서 v_early_grace 선언·설정 폴백·유예 읽기·조퇴 계산 4곳만 바뀜
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
  v_early_grace integer := 10;   -- 시설별 조퇴 유예(분)
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
    v_setting.late_grace_minutes:=20; v_setting.early_leave_grace_minutes:=10;
  END IF;
  v_grace:=GREATEST(0,COALESCE(v_setting.late_grace_minutes,20));
  v_early_grace:=GREATEST(0,COALESCE(v_setting.early_leave_grace_minutes,10));

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
  -- 조퇴도 시설별 유예(기본 10분)를 넘긴 분부터 센다. 유예 안이면 0분 = 정상 퇴근이라
  -- 승인 대기(checkout_pending)로 가지 않고 그 자리에서 퇴근이 확정된다.
  v_early:=GREATEST(0,floor(extract(epoch FROM (v_end_at-v_now))/60)::integer - v_early_grace);

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
-- ③ 확인
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='facility_attendance_settings'
     AND column_name='early_leave_grace_minutes';
  IF v_cnt<>1 THEN RAISE EXCEPTION '컬럼 추가 실패'; END IF;

  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='record_unified_attendance'
     AND pg_get_functiondef(p.oid) LIKE '%v_early_grace%';
  IF v_cnt<1 THEN RAISE EXCEPTION 'RPC 에 조퇴 유예가 반영되지 않음'; END IF;

  RAISE NOTICE '조퇴 유예 적용 완료';
END
$verify$;
