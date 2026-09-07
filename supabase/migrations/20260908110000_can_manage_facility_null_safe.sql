-- can_manage_facility가 접근 행이 없을 때 NULL을 돌려주던 것을 false로 고정한다.
-- PL/pgSQL의 IF NOT NULL 은 예외를 던지지 않으므로, 이 함수를 `IF NOT ...` 로 쓰는 RPC 7곳
-- (accept/reject_shift_application, consume_attendance_qr, issue_facility_attendance_qr, confirm_application_credential …)
-- 이 무관 관리자에게 열려 있었다. 호출부를 전부 고치는 대신 근원 한 곳을 boolean으로 닫는다.
CREATE OR REPLACE FUNCTION public.can_manage_facility(
  p_facility_id uuid,
  p_allowed_roles text[] DEFAULT ARRAY['owner','operator','super']::text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(public.facility_access_role(p_facility_id) = ANY (p_allowed_roles), false);
$$;
SELECT public.can_manage_facility('00000000-0000-0000-0000-000000000001'::uuid) AS should_be_false;
