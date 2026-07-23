-- Coordinates for the authenticated worker's already-authorized shift list.
-- Kept separate from facility SELECT so private facility columns stay hidden.
CREATE OR REPLACE FUNCTION public.get_shift_map_points_secure(p_shift_ids uuid[])
RETURNS TABLE (shift_id uuid, lat double precision, lng double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    s.id,
    public.ST_Y(f.location::public.geometry) AS lat,
    public.ST_X(f.location::public.geometry) AS lng
  FROM public.shifts s
  JOIN public.facilities f ON f.id = s.facility_id
  JOIN public.workers w ON w.auth_user_id = auth.uid()
  WHERE s.id = ANY(COALESCE(p_shift_ids, ARRAY[]::uuid[]))
    AND cardinality(COALESCE(p_shift_ids, ARRAY[]::uuid[])) <= 100
    AND s.status = 'open'
    AND s.shift_date >= (timezone('Asia/Seoul', now()))::date
    AND s.required_role IN (w.role, 'any')
    AND w.verification_status = 'approved'
    AND w.deleted_at IS NULL
    AND f.is_active = true
    AND f.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_shift_map_points_secure(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shift_map_points_secure(uuid[]) TO authenticated;
