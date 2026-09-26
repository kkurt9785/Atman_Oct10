-- 긱워커 시연 근무지(잇닿 팝업스토어 데모)에 대한 시연 관리자(sales-demo-1) 접근 권한 재보장.
-- 20260922120000 이 넣은 facility_admin_access 행이 운영 DB 에서 사라져 관리자 앱의 '긱워커 근태 시연'이
-- W여성병원으로 떨어졌다. 같은 내용을 admin-web /api/set-facility 도 시연 진입 때마다 되살린다(자가 치유).
DO $demo$
DECLARE
  v_admin uuid;
  v_facility uuid;
BEGIN
  SELECT id INTO v_admin FROM auth.users WHERE email = 'sales-demo-1@demo.atman.co.kr';
  SELECT id INTO v_facility FROM public.facilities
  WHERE business_registration_number = 'DEMO-GIGWORKER-2026' AND is_demo = true AND deleted_at IS NULL;
  IF v_admin IS NULL OR v_facility IS NULL THEN
    RAISE NOTICE '긱워커 데모 관리자 또는 근무지가 없어 접근 권한을 건너뜁니다.';
    RETURN;
  END IF;
  INSERT INTO public.facility_admin_access (user_id, facility_id, access_role, can_view_payroll)
  VALUES (v_admin, v_facility, 'super', true)
  ON CONFLICT (user_id, facility_id) DO UPDATE SET access_role = 'super', can_view_payroll = true;
END
$demo$;
