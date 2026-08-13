-- Preserve useful city/district labels while masking contact details that may be
-- entered in the free-form job description.
-- The preceding migration has the original return signatures. PostgreSQL does
-- not allow CREATE OR REPLACE to change OUT columns, so recreate both RPCs.
DROP FUNCTION IF EXISTS public.list_public_shifts(integer);
DROP FUNCTION IF EXISTS public.get_public_shift(uuid);

CREATE OR REPLACE FUNCTION public.list_public_shifts(p_limit integer DEFAULT 50)
RETURNS TABLE(
  id uuid, shift_date date, start_time time, end_time time, created_at timestamptz,
  hourly_wage integer, required_role text, department text, description text,
  facility_name text, facility_type text, region text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.id, s.shift_date, s.start_time, s.end_time, s.created_at,
         s.hourly_wage, s.required_role, s.department,
         regexp_replace(
           regexp_replace(s.description, '[0-9]{2,3}[- .]?[0-9]{3,4}[- .]?[0-9]{4}', '[연락처 비공개]', 'g'),
           '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[이메일 비공개]', 'gi'
         ),
         f.name, f.facility_type,
         NULLIF(CASE
           WHEN split_part(trim(COALESCE(f.address_text,'')), ' ', 1) ~ '도$'
             THEN concat_ws(' ', NULLIF(split_part(trim(f.address_text),' ',2),''), NULLIF(split_part(trim(f.address_text),' ',3),''))
           ELSE concat_ws(' ', NULLIF(split_part(trim(f.address_text),' ',1),''), NULLIF(split_part(trim(f.address_text),' ',2),''))
         END, '')
  FROM public.shifts s JOIN public.facilities f ON f.id=s.facility_id
  WHERE s.status='open' AND COALESCE(s.audience,'public')='public'
    AND s.shift_date >= (now() AT TIME ZONE 'Asia/Seoul')::date
    AND f.is_demo=false AND f.is_active=true AND f.deleted_at IS NULL
  ORDER BY s.shift_date,s.start_time
  LIMIT LEAST(GREATEST(COALESCE(p_limit,50),1),200);
$$;

CREATE OR REPLACE FUNCTION public.get_public_shift(p_id uuid)
RETURNS TABLE(
  id uuid, shift_date date, start_time time, end_time time, created_at timestamptz,
  hourly_wage integer, estimated_total_pay integer,
  required_role text, department text, description text,
  facility_name text, facility_type text, region text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.id,s.shift_date,s.start_time,s.end_time,s.created_at,
         s.hourly_wage,s.estimated_total_pay,s.required_role,s.department,
         regexp_replace(
           regexp_replace(s.description, '[0-9]{2,3}[- .]?[0-9]{3,4}[- .]?[0-9]{4}', '[연락처 비공개]', 'g'),
           '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[이메일 비공개]', 'gi'
         ),
         f.name,f.facility_type,
         NULLIF(CASE
           WHEN split_part(trim(COALESCE(f.address_text,'')), ' ', 1) ~ '도$'
             THEN concat_ws(' ', NULLIF(split_part(trim(f.address_text),' ',2),''), NULLIF(split_part(trim(f.address_text),' ',3),''))
           ELSE concat_ws(' ', NULLIF(split_part(trim(f.address_text),' ',1),''), NULLIF(split_part(trim(f.address_text),' ',2),''))
         END, '')
  FROM public.shifts s JOIN public.facilities f ON f.id=s.facility_id
  WHERE s.id=p_id AND s.status='open' AND COALESCE(s.audience,'public')='public'
    AND s.shift_date >= (now() AT TIME ZONE 'Asia/Seoul')::date
    AND f.is_demo=false AND f.is_active=true AND f.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.list_public_shifts(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_shift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_public_shifts(integer) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_shift(uuid) TO anon,authenticated;
