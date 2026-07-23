-- PostgREST versions may expose the JWT role through request.jwt.claims
-- instead of the legacy request.jwt.claim.role setting. Support both so
-- trusted service-role cron and payment RPCs remain callable.
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) = 'service_role';
$$;

REVOKE ALL ON FUNCTION public.is_service_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO authenticated, service_role;
