-- Keep all six worker personas while limiting the sales story to three
-- facilities. The base reset creates W RN, pharmacy staff and care RN shifts;
-- this wrapper adds pharmacist and care NA shifts.

ALTER FUNCTION public.reset_three_facility_live_demo(uuid)
  RENAME TO reset_three_facility_live_demo_base;

REVOKE ALL ON FUNCTION public.reset_three_facility_live_demo_base(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reset_three_facility_live_demo_base(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.reset_three_facility_live_demo(p_facility_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_primary_shift uuid;
  v_facility public.facilities%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT * INTO v_facility FROM public.facilities
  WHERE id=p_facility_id AND is_demo=true AND is_active=true AND deleted_at IS NULL;
  IF v_facility.id IS NULL THEN RAISE EXCEPTION 'live sales demo facility not found'; END IF;

  DELETE FROM public.shifts
  WHERE facility_id=p_facility_id
    AND notes IN ('LIVE-SALES-DEMO-PHARMACIST','LIVE-SALES-DEMO-CARE-NA');
  v_primary_shift := public.reset_three_facility_live_demo_base(p_facility_id);

  IF v_facility.business_registration_number='DEMO-TARGET-PHARMACY' THEN
    INSERT INTO public.shifts(
      facility_id,required_role,shift_date,start_time,end_time,hourly_wage,
      estimated_total_pay,description,department,notes,status,audience
    ) VALUES (
      p_facility_id,'pharmacist',v_today+1,'09:00','13:00',40000,160000,
      '온누리약국 현장 시연 · 대체약사 지원부터 관리자 수락과 채팅까지 확인합니다.',
      '조제실','LIVE-SALES-DEMO-PHARMACIST','open','public'
    );
  ELSIF v_facility.business_registration_number='DEMO-TARGET-0026' THEN
    INSERT INTO public.shifts(
      facility_id,required_role,shift_date,start_time,end_time,hourly_wage,
      estimated_total_pay,description,department,notes,status,audience
    ) VALUES (
      p_facility_id,'na',v_today+1,'13:00','18:00',16000,80000,
      '수원요양병원 현장 시연 · 간호조무 인력 지원부터 관리자 수락과 채팅까지 확인합니다.',
      '병동','LIVE-SALES-DEMO-CARE-NA','open','public'
    );
  END IF;
  RETURN v_primary_shift;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_three_facility_live_demo(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reset_three_facility_live_demo(uuid) TO service_role;

SELECT public.reset_three_facility_live_demo(f.id)
FROM public.facilities f
WHERE f.is_demo=true AND f.is_active=true AND f.deleted_at IS NULL
  AND f.business_registration_number IN ('DEMO-TARGET-0001','DEMO-TARGET-PHARMACY','DEMO-TARGET-0026');
