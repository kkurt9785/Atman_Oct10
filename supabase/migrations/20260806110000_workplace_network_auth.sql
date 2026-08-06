-- ============================================================================
-- 사업장 네트워크(IP) 출퇴근 인증 (2026-08-06) — 시프티류 국내 표준 차용
-- 사업장 공인 IP를 등록하면, 그 네트워크에서 온 출퇴근 요청을 GPS·QR과
-- 같은 급의 인증 신호로 인정한다 (편의형 모드에서만 OR 신호).
--   · gps_or_qr(기본): GPS → QR → 사업장 네트워크 순으로 통과
--   · gps + QR 폴백: 동일하게 네트워크 폴백 추가
--   · gps_qr(이중 AND)·qr·admin 모드는 불변 (엄격 모드 유지)
-- IP는 PostgREST 요청 헤더(x-forwarded-for 첫 항목)에서 읽는다.
-- ============================================================================

-- ① 설정 컬럼
ALTER TABLE public.facility_attendance_settings
  ADD COLUMN IF NOT EXISTS allowed_ips text[] NOT NULL DEFAULT '{}';

-- ② 인증 방식 CHECK 확장 (WORKPLACE_NET)
ALTER TABLE public.attendance_auth_logs DROP CONSTRAINT IF EXISTS attendance_auth_logs_authentication_method_check;
ALTER TABLE public.attendance_auth_logs ADD CONSTRAINT attendance_auth_logs_authentication_method_check
  CHECK (authentication_method IN ('GPS','GPS_QR','QR','QR_FALLBACK','WORKPLACE_NET','ADMIN'));
ALTER TABLE public.staff_attendances DROP CONSTRAINT IF EXISTS staff_attendances_check_in_method_check;
ALTER TABLE public.staff_attendances ADD CONSTRAINT staff_attendances_check_in_method_check
  CHECK (check_in_method IS NULL OR check_in_method IN ('GPS','GPS_QR','QR','QR_FALLBACK','WORKPLACE_NET','ADMIN'));
ALTER TABLE public.staff_attendances DROP CONSTRAINT IF EXISTS staff_attendances_check_out_method_check;
ALTER TABLE public.staff_attendances ADD CONSTRAINT staff_attendances_check_out_method_check
  CHECK (check_out_method IS NULL OR check_out_method IN ('GPS','GPS_QR','QR','QR_FALLBACK','WORKPLACE_NET','ADMIN'));
ALTER TABLE public.shift_attendances DROP CONSTRAINT IF EXISTS shift_attendances_check_in_method_check;
ALTER TABLE public.shift_attendances ADD CONSTRAINT shift_attendances_check_in_method_check
  CHECK (check_in_method IS NULL OR check_in_method IN ('button','qr','GPS','GPS_QR','QR','QR_FALLBACK','WORKPLACE_NET','ADMIN'));
ALTER TABLE public.shift_attendances DROP CONSTRAINT IF EXISTS shift_attendances_check_out_method_check;
ALTER TABLE public.shift_attendances ADD CONSTRAINT shift_attendances_check_out_method_check
  CHECK (check_out_method IS NULL OR check_out_method IN ('qr','manual_override','GPS','GPS_QR','QR','QR_FALLBACK','WORKPLACE_NET','ADMIN'));

-- ③ 인증 RPC에 네트워크 신호 추가 (fail-loud 문자열 패치)
DO $patch$
DECLARE
  fn regprocedure := to_regprocedure('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)');
  def text; patched text;
BEGIN
  IF fn IS NULL THEN RAISE EXCEPTION 'record_unified_attendance not found'; END IF;
  SELECT pg_get_functiondef(fn) INTO def;
  IF def LIKE '%WORKPLACE_NET%' THEN RAISE NOTICE 'patch skipped: already applied'; RETURN; END IF;

  -- ③-a 변수 선언
  patched := replace(def,
    $a$v_qr_other_facility boolean := false;$a$,
    $b$v_qr_other_facility boolean := false;
  v_ip text;
  v_ip_valid boolean := false;$b$);
  IF patched = def THEN RAISE EXCEPTION 'patch a no-op: declare anchor not found'; END IF;
  def := patched;

  -- ③-b IP 판정 (QR 검사 블록 뒤)
  patched := replace(def,
    $a$) INTO v_qr_other_facility;
  END IF;$a$,
    $b$) INTO v_qr_other_facility;
  END IF;

  v_ip := NULLIF(trim(split_part(COALESCE(
    (current_setting('request.headers', true))::json->>'x-forwarded-for',
    (current_setting('request.headers', true))::json->>'x-real-ip',
    ''), ',', 1)), '');
  v_ip_valid := v_ip IS NOT NULL AND v_setting.allowed_ips IS NOT NULL
    AND v_ip = ANY(v_setting.allowed_ips);$b$);
  IF patched = def THEN RAISE EXCEPTION 'patch b no-op: qr block anchor not found'; END IF;
  def := patched;

  -- ③-c gps 모드: QR 폴백 다음 순위로 네트워크
  patched := replace(def,
    $a$IF v_qr_valid AND v_setting.qr_fallback_enabled THEN v_method:='QR_FALLBACK';
      ELSE$a$,
    $b$IF v_qr_valid AND v_setting.qr_fallback_enabled THEN v_method:='QR_FALLBACK';
      ELSIF v_ip_valid THEN v_method:='WORKPLACE_NET';
      ELSE$b$);
  IF patched = def THEN RAISE EXCEPTION 'patch c no-op: gps fallback anchor not found'; END IF;
  def := patched;

  -- ③-d 기본(gps_or_qr) 모드: GPS → QR → 네트워크
  patched := replace(def,
    $a$IF v_gps_valid THEN v_method:='GPS';
    ELSIF v_qr_valid AND v_setting.qr_fallback_enabled THEN v_method:='QR_FALLBACK';
    ELSE$a$,
    $b$IF v_gps_valid THEN v_method:='GPS';
    ELSIF v_qr_valid AND v_setting.qr_fallback_enabled THEN v_method:='QR_FALLBACK';
    ELSIF v_ip_valid THEN v_method:='WORKPLACE_NET';
    ELSE$b$);
  IF patched = def THEN RAISE EXCEPTION 'patch d no-op: default mode anchor not found'; END IF;

  EXECUTE patched;
END $patch$;

-- 검증 (모두 true면 성공)
SELECT
  strpos(pg_get_functiondef(to_regprocedure('public.record_unified_attendance(text,uuid,text,double precision,double precision,double precision,text)')), 'WORKPLACE_NET') > 0
    AS rpc_patched,
  EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='facility_attendance_settings' AND column_name='allowed_ips')
    AS column_added;
