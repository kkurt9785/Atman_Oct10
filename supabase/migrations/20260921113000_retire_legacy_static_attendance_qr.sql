-- 동적 QR 도입 전 정적 QR 근태 경로를 운영에서 차단한다.
-- 이 RPC는 인증 모드·GPS 정확도·시간 창·시설별 지각/조퇴 유예를 거치지 않아
-- 최신 record_unified_attendance 정책과 서로 다른 결과를 만들 수 있었다.

REVOKE ALL ON FUNCTION public.record_staff_qr_attendance(uuid,double precision,double precision)
  FROM PUBLIC, anon, authenticated;

DO $verify$
DECLARE
  v_has_authenticated boolean;
BEGIN
  SELECT has_function_privilege(
    'authenticated',
    'public.record_staff_qr_attendance(uuid,double precision,double precision)'::regprocedure,
    'EXECUTE'
  ) INTO v_has_authenticated;

  IF v_has_authenticated THEN
    RAISE EXCEPTION 'legacy static attendance QR RPC is still executable by authenticated users';
  END IF;
END
$verify$;
