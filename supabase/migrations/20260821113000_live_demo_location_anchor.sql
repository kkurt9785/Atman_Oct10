-- A temporary, in-person sales aid.  It is deliberately restricted in the
-- database to the three seeded demo facilities; ordinary subscribers cannot
-- move their workplace location with this RPC.
CREATE OR REPLACE FUNCTION public.set_live_demo_attendance_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_facility public.facilities%ROWTYPE;
  v_radius integer := 100;
  v_worker_emails text[];
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION '현재 위치 좌표를 확인할 수 없어요';
  END IF;
  IF p_accuracy IS NOT NULL AND (p_accuracy < 0 OR p_accuracy > 5000) THEN
    RAISE EXCEPTION '위치 정확도 값을 확인해 주세요';
  END IF;

  SELECT * INTO v_facility
  FROM public.facilities
  WHERE id IN (
    SELECT facility_id FROM public.facility_admin_access
    WHERE user_id = auth.uid() AND access_role IN ('owner','operator','super')
    UNION
    SELECT id FROM public.facilities WHERE admin_user_id = auth.uid()
  )
    AND is_demo = true
    AND is_active = true
    AND deleted_at IS NULL
    AND business_registration_number IN ('DEMO-TARGET-0001','DEMO-TARGET-PHARMACY','DEMO-TARGET-0026')
  LIMIT 1;
  IF v_facility.id IS NULL THEN
    RAISE EXCEPTION '지정된 현장 시연 사업장에서만 현재 위치를 사용할 수 있어요';
  END IF;

  UPDATE public.facilities
  SET location = public.ST_SetSRID(public.ST_MakePoint(p_lng, p_lat), 4326)::public.geography,
      updated_at = now()
  WHERE id = v_facility.id;

  -- The worker app discovers shifts from the selected work-area preference.
  -- Keep only the matching demo personas aligned to this temporary facility.
  v_worker_emails := CASE v_facility.business_registration_number
    WHEN 'DEMO-TARGET-0001' THEN ARRAY['worker-demo-1@demo.atman.co.kr']
    WHEN 'DEMO-TARGET-PHARMACY' THEN ARRAY['worker-demo-2@demo.atman.co.kr','worker-demo-6@demo.atman.co.kr']
    ELSE ARRAY['worker-demo-3@demo.atman.co.kr','worker-demo-4@demo.atman.co.kr','worker-demo-5@demo.atman.co.kr']
  END;
  INSERT INTO public.worker_location_prefs(worker_id, locations)
  SELECT u.id, jsonb_build_array(jsonb_build_object(
    'label', '현장 시연 위치', 'radius_km', 10,
    'lat', p_lat, 'lng', p_lng
  ))
  FROM auth.users u
  WHERE u.email = ANY(v_worker_emails)
  ON CONFLICT(worker_id) DO UPDATE SET locations = EXCLUDED.locations, updated_at = now();

  INSERT INTO public.facility_attendance_settings(
    facility_id, authentication_mode, gps_radius_meters, max_gps_accuracy_meters,
    qr_fallback_enabled, updated_by, updated_at
  ) VALUES (
    v_facility.id, 'gps_or_qr', v_radius, 100, true, auth.uid(), now()
  ) ON CONFLICT(facility_id) DO UPDATE SET
    authentication_mode = 'gps_or_qr', gps_radius_meters = v_radius,
    max_gps_accuracy_meters = 100, qr_fallback_enabled = true,
    updated_by = auth.uid(), updated_at = now();

  INSERT INTO public.audit_logs(actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('admin', auth.uid(), 'live_demo.location_anchor', 'facility', v_facility.id,
    jsonb_build_object('lat', round(p_lat::numeric, 5), 'lng', round(p_lng::numeric, 5),
      'accuracy_m', p_accuracy, 'radius_m', v_radius));

  RETURN jsonb_build_object('ok', true, 'facilityId', v_facility.id, 'radiusM', v_radius);
END;
$$;

REVOKE ALL ON FUNCTION public.set_live_demo_attendance_location(double precision,double precision,double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_live_demo_attendance_location(double precision,double precision,double precision) TO authenticated;

SELECT to_regprocedure('public.set_live_demo_attendance_location(double precision,double precision,double precision)') IS NOT NULL AS live_demo_location_ready;
