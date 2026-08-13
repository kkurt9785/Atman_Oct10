-- ============================================================================
-- 공개 공고 조회 (2026-08-13) — 로그인 없이 보이는 SEO 페이지용
-- 목적: "수원 간호조무사 대타" 검색 유입 → 워커 무료 획득 채널.
-- 원칙:
--   · anon에게 RLS를 열지 않고, SECURITY DEFINER RPC로 필요한 필드만 노출
--   · 노출 금지: 연락처·정확한 좌표·내부 id 외 식별정보·데모 시설·비공개(초대) 공고
--   · 모집 중(open) + 오늘 이후 + audience='public' 만
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_public_shifts(p_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid, shift_date date, start_time time, end_time time,
  hourly_wage integer, required_role text, department text, description text,
  facility_name text, facility_type text, region text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, s.shift_date, s.start_time, s.end_time,
         s.hourly_wage, s.required_role, s.department, s.description,
         f.name,
         f.facility_type,
         -- 주소는 시/구 단위까지만 (정확한 번지 비노출)
         NULLIF(regexp_replace(COALESCE(f.address_text, ''), '^(\S+\s+\S+).*$', '\1'), '')
  FROM public.shifts s
  JOIN public.facilities f ON f.id = s.facility_id
  WHERE s.status = 'open'
    AND COALESCE(s.audience, 'public') = 'public'
    AND s.shift_date >= (now() AT TIME ZONE 'Asia/Seoul')::date
    AND f.is_demo = false
    AND f.is_active = true
    AND f.deleted_at IS NULL
  ORDER BY s.shift_date, s.start_time
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

CREATE OR REPLACE FUNCTION public.get_public_shift(p_id uuid)
RETURNS TABLE(
  id uuid, shift_date date, start_time time, end_time time,
  hourly_wage integer, estimated_total_pay integer,
  required_role text, department text, description text, notes text,
  facility_name text, facility_type text, region text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.id, s.shift_date, s.start_time, s.end_time,
         s.hourly_wage, s.estimated_total_pay,
         s.required_role, s.department, s.description, s.notes,
         f.name, f.facility_type,
         NULLIF(regexp_replace(COALESCE(f.address_text, ''), '^(\S+\s+\S+).*$', '\1'), '')
  FROM public.shifts s
  JOIN public.facilities f ON f.id = s.facility_id
  WHERE s.id = p_id
    AND s.status = 'open'
    AND COALESCE(s.audience, 'public') = 'public'
    AND s.shift_date >= (now() AT TIME ZONE 'Asia/Seoul')::date
    AND f.is_demo = false
    AND f.is_active = true
    AND f.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.list_public_shifts(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_shift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_shifts(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_shift(uuid) TO anon, authenticated;

-- 검증 (둘 다 true면 성공 — 건수는 0이어도 정상: 실제 공고가 없을 뿐)
SELECT
  to_regprocedure('public.list_public_shifts(integer)') IS NOT NULL AS list_created,
  to_regprocedure('public.get_public_shift(uuid)') IS NOT NULL AS detail_created,
  (SELECT count(*) FROM public.list_public_shifts(200)) AS public_shift_count;
