-- Allow facilities to use registered workplace Wi-Fi/public IP as a standalone
-- attendance policy. Existing gps_or_qr and gps policies keep WORKPLACE_NET as
-- their final fallback when an allowed IP is registered.

ALTER TABLE public.facility_attendance_settings
  DROP CONSTRAINT IF EXISTS facility_attendance_settings_authentication_mode_check;
ALTER TABLE public.facility_attendance_settings
  ADD CONSTRAINT facility_attendance_settings_authentication_mode_check
  CHECK (authentication_mode IN ('gps','gps_qr','qr','network','admin','gps_or_qr'));

ALTER TABLE public.attendance_auth_logs
  DROP CONSTRAINT IF EXISTS attendance_auth_logs_failure_reason_check;
ALTER TABLE public.attendance_auth_logs
  ADD CONSTRAINT attendance_auth_logs_failure_reason_check
  CHECK (failure_reason IS NULL OR failure_reason IN (
    'OUT_OF_RANGE','GPS_ERROR','GPS_ACCURACY_LOW','QR_EXPIRED','QR_INVALID',
    'HOSPITAL_MISMATCH','TIME_NOT_ALLOWED','DUPLICATE_ATTENDANCE',
    'NOT_ASSIGNED','INVALID_STATE','ADMIN_REQUIRED','NETWORK_NOT_ALLOWED'
  ));

DO $patch$
DECLARE
  fn regprocedure := to_regprocedure(
    'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'
  );
  def text;
  patched text;
BEGIN
  IF fn IS NULL THEN
    RAISE EXCEPTION 'record_unified_attendance not found';
  END IF;

  SELECT pg_get_functiondef(fn) INTO def;
  IF def NOT LIKE '%v_ip_valid%' OR def NOT LIKE '%WORKPLACE_NET%' THEN
    RAISE EXCEPTION 'workplace network authentication patch is missing';
  END IF;

  IF def NOT LIKE '%authentication_mode=''network''%' THEN
    patched := replace(
      def,
      $a$IF v_setting.authentication_mode='admin' THEN$a$,
      $b$IF v_setting.authentication_mode='network' THEN
    v_method:='WORKPLACE_NET';
    IF NOT v_ip_valid THEN v_failure:='NETWORK_NOT_ALLOWED'; END IF;
  ELSIF v_setting.authentication_mode='admin' THEN$b$
    );
    IF patched = def THEN
      RAISE EXCEPTION 'network-only mode patch anchor not found';
    END IF;
    def := patched;
  END IF;

  IF def NOT LIKE '%WHEN ''NETWORK_NOT_ALLOWED''%' THEN
    patched := replace(
      def,
      $a$WHEN 'ADMIN_REQUIRED' THEN '이 사업장은 관리자 승인 방식으로 운영 중이에요.'$a$,
      $b$WHEN 'NETWORK_NOT_ALLOWED' THEN '등록된 사업장 Wi-Fi에 연결한 뒤 다시 시도해 주세요.'
        WHEN 'ADMIN_REQUIRED' THEN '이 사업장은 관리자 승인 방식으로 운영 중이에요.'$b$
    );
    IF patched = def THEN
      RAISE EXCEPTION 'network failure message patch anchor not found';
    END IF;
    def := patched;
  END IF;

  EXECUTE def;
END $patch$;

SELECT
  strpos(
    pg_get_functiondef(to_regprocedure(
      'public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)'
    )),
    'NETWORK_NOT_ALLOWED'
  ) > 0 AS network_only_mode_ready;
