-- GPS mode may use a valid dynamic QR as an explicitly enabled fallback.
-- Distinguish unknown QR tokens from known but expired tokens.
DO $patch$
DECLARE
  v_sql text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(
    'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'::regprocedure
  ) INTO v_sql;
  v_before:=v_sql;
  v_sql:=replace(v_sql,
    'v_qr_valid boolean := false;',
    'v_qr_valid boolean := false;
  v_qr_exists boolean := false;');
  v_sql:=replace(v_sql,
    'v_qr_hash:=encode(extensions.digest(p_qr_token,''sha256''),''hex'');
    SELECT EXISTS(',
    'v_qr_hash:=encode(extensions.digest(p_qr_token,''sha256''),''hex'');
    SELECT EXISTS(
      SELECT 1 FROM public.facility_attendance_qr_challenges
      WHERE token_hash=v_qr_hash
    ) INTO v_qr_exists;
    SELECT EXISTS(');
  v_sql:=replace(v_sql,
    'IF NOT v_gps_valid THEN
      v_failure:=CASE WHEN v_point IS NULL THEN ''GPS_ERROR''
        WHEN v_accuracy IS NULL OR v_accuracy>v_setting.max_gps_accuracy_meters THEN ''GPS_ACCURACY_LOW''
        ELSE ''OUT_OF_RANGE'' END;
    END IF;
  ELSIF v_setting.authentication_mode=''gps_qr'' THEN',
    'IF NOT v_gps_valid THEN
      IF v_qr_valid AND v_setting.qr_fallback_enabled THEN v_method:=''QR_FALLBACK'';
      ELSE
        v_failure:=CASE WHEN v_point IS NULL THEN ''GPS_ERROR''
          WHEN v_accuracy IS NULL OR v_accuracy>v_setting.max_gps_accuracy_meters THEN ''GPS_ACCURACY_LOW''
          ELSE ''OUT_OF_RANGE'' END;
      END IF;
    END IF;
  ELSIF v_setting.authentication_mode=''gps_qr'' THEN');
  v_sql:=replace(v_sql,
    'WHEN p_qr_token IS NULL THEN ''QR_INVALID'' ELSE ''QR_EXPIRED'' END;',
    'WHEN NOT v_qr_exists THEN ''QR_INVALID'' ELSE ''QR_EXPIRED'' END;');
  IF v_sql=v_before OR v_sql NOT LIKE '%v_qr_exists boolean := false%' OR
     v_sql NOT LIKE '%v_setting.qr_fallback_enabled THEN v_method:=''QR_FALLBACK''%' THEN
    RAISE EXCEPTION 'record_unified_attendance fallback patch was incomplete';
  END IF;
  EXECUTE v_sql;
END $patch$;

-- Raw attempt coordinates are short-lived. Derived distance/result records are
-- retained for payroll and attendance dispute evidence.
CREATE OR REPLACE FUNCTION public.apply_attendance_location_retention()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.attendance_auth_logs
  SET latitude=NULL,longitude=NULL
  WHERE created_at<now()-interval '90 days'
    AND (latitude IS NOT NULL OR longitude IS NOT NULL);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  UPDATE public.staff_attendances
  SET check_in_location=NULL,check_out_location=NULL
  WHERE work_date<current_date-90
    AND (check_in_location IS NOT NULL OR check_out_location IS NOT NULL);
  UPDATE public.shift_attendances AS attendance
  SET check_in_location=NULL,check_out_location=NULL
  FROM public.shifts AS shift
  WHERE shift.id=attendance.shift_id
    AND shift.shift_date<current_date-90
    AND (attendance.check_in_location IS NOT NULL OR attendance.check_out_location IS NOT NULL);
  DELETE FROM public.attendance_auth_logs
  WHERE created_at<now()-interval '3 years';
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_attendance_location_retention() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_attendance_location_retention() TO service_role;

SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname='attendance_location_retention_daily';
SELECT cron.schedule(
  'attendance_location_retention_daily','25 15 * * *',
  'select public.apply_attendance_location_retention();'
);
