-- Send public shift notifications only to approved workers whose role and
-- saved activity radius match the facility. Invited shifts remain targeted
-- explicitly by the application layer.
CREATE OR REPLACE FUNCTION public.get_shift_notification_recipients(p_shift_id uuid)
RETURNS TABLE(auth_user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT w.auth_user_id
  FROM public.shifts s
  JOIN public.facilities f ON f.id = s.facility_id
  JOIN public.workers w
    ON s.required_role IN (w.role, 'any')
   AND w.verification_status = 'approved'
   AND w.deleted_at IS NULL
   AND w.auth_user_id IS NOT NULL
  JOIN public.worker_location_prefs pref ON pref.worker_id = w.auth_user_id
  CROSS JOIN LATERAL jsonb_array_elements(pref.locations) loc
  WHERE s.id = p_shift_id
    AND s.audience = 'public'
    AND f.is_active = true
    AND f.deleted_at IS NULL
    AND COALESCE(loc->>'lat', '') ~ '^-?[0-9]+([.][0-9]+)?$'
    AND COALESCE(loc->>'lng', '') ~ '^-?[0-9]+([.][0-9]+)?$'
    AND (loc->>'lat')::double precision BETWEEN -90 AND 90
    AND (loc->>'lng')::double precision BETWEEN -180 AND 180
    AND public.ST_DWithin(
      f.location,
      public.ST_SetSRID(public.ST_MakePoint(
        (loc->>'lng')::double precision,
        (loc->>'lat')::double precision
      ), 4326)::public.geography,
      LEAST(30000, GREATEST(1000, COALESCE((loc->>'radius_km')::double precision, 5) * 1000))
    );
$$;

REVOKE ALL ON FUNCTION public.get_shift_notification_recipients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shift_notification_recipients(uuid) TO service_role;
