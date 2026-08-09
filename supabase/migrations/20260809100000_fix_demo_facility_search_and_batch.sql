-- 데모 연결 화면 검색과 서버 아침 재시드 권한 정렬.
-- 일반 사업장은 기존대로 미연결+유효 초대코드 조건을 유지하고,
-- 시연용 사업장만 2026 마스터 코드 연결을 위해 검색 결과에 노출한다.
CREATE OR REPLACE FUNCTION public.search_claimable_facilities(p_query text)
RETURNS TABLE (
  id uuid,
  name text,
  facility_type text,
  address_text text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.id, f.name, f.facility_type, f.address_text
  FROM public.facilities AS f
  JOIN public.profiles AS p ON p.id = auth.uid() AND p.role = 'admin'
  WHERE length(regexp_replace(trim(p_query), '\s+', '', 'g')) >= 2
    AND regexp_replace(f.name, '\s+', '', 'g')
        ILIKE '%' || regexp_replace(trim(p_query), '\s+', '', 'g') || '%'
    AND f.is_active = true
    AND f.deleted_at IS NULL
    AND (
      f.is_demo = true
      OR (
        f.admin_user_id IS NULL
        AND f.invite_code_hash IS NOT NULL
        AND (f.invite_code_expires_at IS NULL OR f.invite_code_expires_at > now())
      )
    )
  ORDER BY f.is_demo DESC, f.name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.search_claimable_facilities(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_claimable_facilities(text) TO authenticated;

-- 서버의 service-role 재시드 route에서만 호출한다. anon/authenticated에는 열지 않는다.
REVOKE ALL ON FUNCTION public.refresh_demo_pharmacy_workforce() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_demo_pharmacy_workforce() TO service_role;
REVOKE ALL ON FUNCTION public.ensure_demo1_wf_application() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_demo1_wf_application() TO service_role;

-- pg_cron 기존 스케줄도 서버 배치 직후인 08:40/08:50 KST로 정렬한다.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demo-pharmacy-workforce-daily';
SELECT cron.schedule(
  'demo-pharmacy-workforce-daily', '40 23 * * *',
  'SELECT public.refresh_demo_pharmacy_workforce();'
);
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demo1-wf-application-daily';
SELECT cron.schedule(
  'demo1-wf-application-daily', '50 23 * * *',
  'SELECT public.ensure_demo1_wf_application();'
);
