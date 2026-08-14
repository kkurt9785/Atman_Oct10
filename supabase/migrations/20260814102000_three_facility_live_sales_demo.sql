-- Repeatable two-device sales demo:
-- worker applies -> facility admins are notified -> admin accepts -> worker is
-- notified -> both sides can chat on the accepted application.

DO $$
DECLARE
  v_demo2_user uuid;
  v_demo3_user uuid;
  v_pharmacy_staff uuid;
  v_care_nurse uuid;
BEGIN
  SELECT id INTO v_demo2_user FROM auth.users WHERE email='worker-demo-2@demo.atman.co.kr';
  SELECT id INTO v_demo3_user FROM auth.users WHERE email='worker-demo-3@demo.atman.co.kr';
  SELECT s.worker_id INTO v_pharmacy_staff
  FROM public.facility_staff s JOIN public.facilities f ON f.id=s.facility_id
  WHERE f.business_registration_number='DEMO-TARGET-PHARMACY'
    AND s.role='pharmacy_staff' AND s.worker_id IS NOT NULL
  ORDER BY s.created_at LIMIT 1;
  SELECT s.worker_id INTO v_care_nurse
  FROM public.facility_staff s JOIN public.facilities f ON f.id=s.facility_id
  WHERE f.business_registration_number='DEMO-TARGET-0026'
    AND s.worker_id IS NOT NULL
  ORDER BY CASE WHEN s.role='rn' THEN 0 ELSE 1 END,s.created_at LIMIT 1;
  IF v_demo2_user IS NULL OR v_demo3_user IS NULL OR v_pharmacy_staff IS NULL OR v_care_nurse IS NULL THEN
    RAISE EXCEPTION 'three-facility live demo account target is missing';
  END IF;

  UPDATE public.workers SET auth_user_id=NULL,updated_at=now()
  WHERE auth_user_id IN (v_demo2_user,v_demo3_user)
    AND id NOT IN (v_pharmacy_staff,v_care_nurse);
  UPDATE public.workers SET
    auth_user_id=v_demo2_user,email='worker-demo-2@demo.atman.co.kr',
    name='수원 온누리약국 데모직원',role='pharmacy_staff',verification_status='approved',
    verified_at=COALESCE(verified_at,now()),is_demo=true,deleted_at=NULL,updated_at=now()
  WHERE id=v_pharmacy_staff;
  UPDATE public.workers SET
    auth_user_id=v_demo3_user,email='worker-demo-3@demo.atman.co.kr',
    name='수원요양병원 데모간호사',role='rn',verification_status='approved',
    verified_at=COALESCE(verified_at,now()),is_demo=true,deleted_at=NULL,updated_at=now()
  WHERE id=v_care_nurse;

  INSERT INTO public.worker_location_prefs(worker_id,locations)
  SELECT target.auth_id,jsonb_build_array(jsonb_build_object(
    'label',target.label,'radius_km',8,
    'lat',public.ST_Y(f.location::public.geometry),
    'lng',public.ST_X(f.location::public.geometry)
  ))
  FROM (VALUES
    (v_demo2_user,'DEMO-TARGET-PHARMACY','수원 권선구'),
    (v_demo3_user,'DEMO-TARGET-0026','수원 권선구')
  ) AS target(auth_id,registration,label)
  JOIN public.facilities f ON f.business_registration_number=target.registration
  WHERE f.is_demo=true AND f.is_active=true AND f.deleted_at IS NULL
  ON CONFLICT(worker_id) DO UPDATE SET locations=EXCLUDED.locations,updated_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.reset_three_facility_live_demo(p_facility_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_facility public.facilities%ROWTYPE;
  v_worker uuid;
  v_role text;
  v_email text;
  v_shift uuid;
  v_start time;
  v_end time;
  v_wage integer;
  v_department text;
  v_description text;
  v_tag text;
BEGIN
  SELECT * INTO v_facility FROM public.facilities
  WHERE id=p_facility_id AND is_demo=true AND is_active=true AND deleted_at IS NULL
    AND business_registration_number IN ('DEMO-TARGET-0001','DEMO-TARGET-PHARMACY','DEMO-TARGET-0026');
  IF v_facility.id IS NULL THEN RAISE EXCEPTION 'live sales demo facility not found'; END IF;

  IF v_facility.business_registration_number='DEMO-TARGET-0001' THEN
    v_email:='worker-demo-1@demo.atman.co.kr'; v_role:='rn'; v_start:='09:00'; v_end:='17:00';
    v_wage:=18000; v_department:='병동'; v_tag:='LIVE-SALES-DEMO-W';
    v_description:='W여성병원 현장 시연 · 지원 알림부터 수락과 채팅까지 직접 확인합니다.';
  ELSIF v_facility.business_registration_number='DEMO-TARGET-PHARMACY' THEN
    v_email:='worker-demo-2@demo.atman.co.kr'; v_role:='pharmacy_staff'; v_start:='14:00'; v_end:='18:00';
    v_wage:=15000; v_department:='전산·접수'; v_tag:='LIVE-SALES-DEMO-PHARMACY';
    v_description:='온누리약국 현장 시연 · 전산과 접수 단기근무 지원부터 채팅까지 확인합니다.';
  ELSE
    v_email:='worker-demo-3@demo.atman.co.kr'; v_role:='rn'; v_start:='08:00'; v_end:='17:00';
    v_wage:=19000; v_department:='병동'; v_tag:='LIVE-SALES-DEMO-CARE';
    v_description:='수원요양병원 현장 시연 · 간호 인력 지원부터 관리자 수락과 채팅까지 확인합니다.';
  END IF;
  SELECT w.id INTO v_worker FROM public.workers w JOIN auth.users u ON u.id=w.auth_user_id
  WHERE u.email=v_email AND w.role=v_role AND w.verification_status='approved' AND w.deleted_at IS NULL;
  IF v_worker IS NULL THEN RAISE EXCEPTION 'live sales demo worker not found: %',v_email; END IF;

  -- Remove only future, unfinished state for this dedicated demo worker. Past
  -- attendance and payroll showcase data remain intact.
  DELETE FROM public.shifts
  WHERE notes IN ('LIVE-SALES-DEMO-W','LIVE-SALES-DEMO-PHARMACY','LIVE-SALES-DEMO-CARE')
    AND facility_id=p_facility_id;
  DELETE FROM public.shift_applications a USING public.shifts s
  WHERE a.shift_id=s.id AND a.worker_id=v_worker
    AND s.shift_date>=v_today AND a.status NOT IN ('completed')
    AND NOT EXISTS (SELECT 1 FROM public.shift_attendances attendance WHERE attendance.application_id=a.id);
  IF v_email='worker-demo-1@demo.atman.co.kr' THEN
    DELETE FROM public.shifts WHERE notes='DEMO-1-CHAT-SHOWCASE' AND facility_id=p_facility_id;
  END IF;

  INSERT INTO public.shifts(
    facility_id,required_role,shift_date,start_time,end_time,hourly_wage,
    estimated_total_pay,description,department,notes,status,audience
  ) VALUES (
    p_facility_id,v_role,v_today+1,v_start,v_end,v_wage,
    round((CASE WHEN v_end<=v_start THEN 1440 ELSE 0 END
      + extract(hour from v_end)*60+extract(minute from v_end)
      - extract(hour from v_start)*60-extract(minute from v_start))/60.0*v_wage),
    v_description,v_department,v_tag,'open','public'
  ) RETURNING id INTO v_shift;
  RETURN v_shift;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_three_facility_live_demo(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reset_three_facility_live_demo(uuid) TO service_role;

-- Old pre-applied/chat seeds conflict with a true live, from-zero demonstration.
SELECT cron.unschedule(jobid) FROM cron.job
WHERE jobname IN ('demo1-wf-application-daily','demo1-chat-showcase-daily');

SELECT public.reset_three_facility_live_demo(f.id)
FROM public.facilities f
WHERE f.is_demo=true AND f.is_active=true AND f.deleted_at IS NULL
  AND f.business_registration_number IN ('DEMO-TARGET-0001','DEMO-TARGET-PHARMACY','DEMO-TARGET-0026');
