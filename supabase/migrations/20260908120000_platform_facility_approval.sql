-- 잇닿 운영자 승인 화면용 목록 RPC. service_role 전용(앱 서버에서 PLATFORM_ADMIN_EMAILS 게이트 뒤에서만 호출).
-- 좌표는 ST_X/ST_Y로 풀어 주고, 등록 관리자 이메일은 auth.users에서 붙인다.
-- SQL Editor에서 선행 설치된 구버전은 OUT 컬럼이 달라 OR REPLACE가 실패할 수 있다.
DROP FUNCTION IF EXISTS public.platform_list_self_registered_facilities(boolean);
CREATE FUNCTION public.platform_list_self_registered_facilities(p_pending_only boolean DEFAULT true)
RETURNS TABLE (
  id uuid, name text, facility_type text, address_text text, contact_phone text,
  hira_ykiho text, hira_cl_cd text, registration_source text, business_registration_number text,
  approved_at timestamptz, is_active boolean, created_at timestamptz,
  admin_user_id uuid, admin_email text, lng double precision, lat double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.id, f.name, f.facility_type, f.address_text, f.contact_phone,
         f.hira_ykiho, f.hira_cl_cd, f.registration_source, f.business_registration_number,
         f.approved_at, f.is_active, f.created_at,
         f.admin_user_id, u.email::text,
         public.ST_X(f.location::public.geometry), public.ST_Y(f.location::public.geometry)
  FROM public.facilities AS f
  LEFT JOIN auth.users AS u ON u.id = f.admin_user_id
  WHERE f.registration_source IN ('self_hira', 'self_kakao')
    AND f.deleted_at IS NULL
    AND (NOT p_pending_only OR f.approved_at IS NULL)
  ORDER BY f.approved_at NULLS FIRST, f.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.platform_list_self_registered_facilities(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_self_registered_facilities(boolean) TO service_role;
SELECT (SELECT count(*) FROM pg_proc WHERE proname = 'platform_list_self_registered_facilities') AS rpc_1;
