-- Four non-overlapping worker personas cover all three sales sectors.
-- Demo 3/4 accounts and historical records are preserved, but they no longer
-- receive location-matched live-demo notifications.

DO $$
DECLARE
  v_demo1 uuid;
  v_demo3 uuid;
  v_demo4 uuid;
  v_small public.facilities%ROWTYPE;
  v_care public.facilities%ROWTYPE;
BEGIN
  SELECT id INTO v_demo1 FROM auth.users WHERE email='worker-demo-1@demo.atman.co.kr';
  SELECT id INTO v_demo3 FROM auth.users WHERE email='worker-demo-3@demo.atman.co.kr';
  SELECT id INTO v_demo4 FROM auth.users WHERE email='worker-demo-4@demo.atman.co.kr';
  SELECT * INTO v_small FROM public.facilities
  WHERE business_registration_number='DEMO-TARGET-0001' AND is_demo=true AND is_active=true AND deleted_at IS NULL;
  SELECT * INTO v_care FROM public.facilities
  WHERE business_registration_number='DEMO-TARGET-0026' AND is_demo=true AND is_active=true AND deleted_at IS NULL;
  IF v_demo1 IS NULL OR v_small.id IS NULL OR v_care.id IS NULL THEN
    RAISE EXCEPTION 'four-persona demo target is missing';
  END IF;

  INSERT INTO public.worker_location_prefs(worker_id,locations)
  VALUES (v_demo1,jsonb_build_array(
    jsonb_build_object(
      'label','광주 광산구','radius_km',10,
      'lat',public.ST_Y(v_small.location::public.geometry),
      'lng',public.ST_X(v_small.location::public.geometry)
    ),
    jsonb_build_object(
      'label','수원 권선구','radius_km',10,
      'lat',public.ST_Y(v_care.location::public.geometry),
      'lng',public.ST_X(v_care.location::public.geometry)
    )
  ))
  ON CONFLICT(worker_id) DO UPDATE SET locations=EXCLUDED.locations,updated_at=now();

  -- Retain the accounts for regression/history access but keep them out of the
  -- live location-matched notification pool.
  DELETE FROM public.worker_location_prefs WHERE worker_id IN (v_demo3,v_demo4);
END $$;
