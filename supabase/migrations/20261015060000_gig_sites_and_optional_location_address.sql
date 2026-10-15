-- Keep medical ownership uniqueness, while allowing one owner to operate multiple gig sites.
ALTER TABLE public.facilities DROP CONSTRAINT facilities_admin_user_id_key;
CREATE UNIQUE INDEX facilities_medical_owner_unique ON public.facilities(admin_user_id)
  WHERE facility_type <> 'gigworker';
ALTER TABLE public.facilities ADD COLUMN creation_request_id uuid;
CREATE UNIQUE INDEX facilities_creation_request_unique ON public.facilities(admin_user_id, creation_request_id)
  WHERE creation_request_id IS NOT NULL;

CREATE FUNCTION public.register_gigworker_site(p_name text,p_address_text text,p_lng double precision,p_lat double precision,p_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_name text:=btrim(coalesce(p_name,'')); v_today date:=(now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin') THEN RAISE EXCEPTION '관리자 계정만 현장을 만들 수 있어요'; END IF;
  IF public.is_demo_account(auth.uid()) THEN RAISE EXCEPTION '시연에서는 현장을 추가하지 않아요. 내 계정으로 시작해 주세요'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION '등록 요청을 다시 시작해 주세요'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gig-site:'||auth.uid()::text,0));
  SELECT id INTO v_id FROM public.facilities WHERE admin_user_id=auth.uid() AND creation_request_id=p_request_id;
  IF FOUND THEN RETURN v_id; END IF;
  IF char_length(v_name) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION '현장 이름은 2~100자로 입력해 주세요'; END IF;
  IF char_length(coalesce(p_address_text,''))>300 THEN RAISE EXCEPTION '주소·현장 안내는 300자 이내로 입력해 주세요'; END IF;
  IF p_lng IS NULL OR p_lat IS NULL OR p_lng NOT BETWEEN 124 AND 132 OR p_lat NOT BETWEEN 33 AND 39 THEN RAISE EXCEPTION '현장 위치를 지도에서 확인해 주세요'; END IF;
  INSERT INTO public.facilities(name,facility_type,business_registration_number,address_text,location,admin_user_id,is_active,approved_at,registration_source,plan_code,is_demo,creation_request_id)
  VALUES(v_name,'gigworker','GIG-'||upper(left(replace(gen_random_uuid()::text,'-',''),10)),coalesce(nullif(btrim(p_address_text),''),'위치 기반 근무지'),
    public.ST_SetSRID(public.ST_MakePoint(p_lng,p_lat),4326)::public.geography,auth.uid(),true,now(),'gigworker_trial','gigworker_trial',false,p_request_id)
  RETURNING id INTO v_id;
  INSERT INTO public.facility_attendance_settings(facility_id,authentication_mode,gps_radius_meters,max_gps_accuracy_meters,qr_fallback_enabled)
  VALUES(v_id,'gps_or_qr',100,150,true)
  ON CONFLICT(facility_id) DO UPDATE SET authentication_mode='gps_or_qr',gps_radius_meters=100,max_gps_accuracy_meters=150,qr_fallback_enabled=true;
  INSERT INTO public.facility_subscriptions(facility_id,plan_code,status,billing_cycle,current_period_start,current_period_end,trial_started_at,trial_ends_at)
  VALUES(v_id,'gigworker_trial','active','monthly',v_today,NULL,NULL,NULL);
  INSERT INTO public.audit_logs(actor_type,actor_id,action,entity_type,entity_id,after_data)
  VALUES('admin',auth.uid(),'facility.gig_site.create','facility',v_id,jsonb_build_object('name',v_name,'lat',p_lat,'lng',p_lng));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_gigworker_site(text,text,double precision,double precision,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_gigworker_site(text,text,double precision,double precision,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_facility_location(p_facility_id uuid,p_name text,p_address_text text,p_phone text,p_lng double precision,p_lat double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_before jsonb; v_address text:=coalesce(nullif(btrim(p_address_text),''),'위치 기반 근무지');
BEGIN
  IF public.can_manage_facility(p_facility_id,ARRAY['owner','operator','super']::text[]) IS DISTINCT FROM true THEN RAISE EXCEPTION '이 사업장을 수정할 권한이 없어요'; END IF;
  IF EXISTS(SELECT 1 FROM public.facilities WHERE id=p_facility_id AND is_demo) THEN RAISE EXCEPTION '시연에서는 위치를 저장하지 않아요'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION '사업장명을 확인해 주세요'; END IF;
  IF char_length(v_address)>300 THEN RAISE EXCEPTION '주소·현장 안내는 300자 이내로 입력해 주세요'; END IF;
  IF p_lng IS NULL OR p_lat IS NULL OR p_lng NOT BETWEEN 124 AND 132 OR p_lat NOT BETWEEN 33 AND 39 THEN RAISE EXCEPTION '사업장 위치를 지도에서 확인해 주세요'; END IF;
  SELECT jsonb_build_object('name',name,'address_text',address_text,'location',location,'contact_phone',contact_phone) INTO v_before
    FROM public.facilities WHERE id=p_facility_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '사업장을 찾을 수 없어요'; END IF;
  UPDATE public.facilities SET name=btrim(p_name),address_text=v_address,contact_phone=nullif(btrim(p_phone),''),
    location=public.ST_SetSRID(public.ST_MakePoint(p_lng,p_lat),4326)::public.geography,updated_at=now() WHERE id=p_facility_id;
  INSERT INTO public.audit_logs(actor_type,actor_id,action,entity_type,entity_id,before_data,after_data)
  VALUES('admin',auth.uid(),'facility.location.update','facility',p_facility_id,v_before,jsonb_build_object('name',btrim(p_name),'address_text',v_address,'lng',p_lng,'lat',p_lat));
END;
$$;
REVOKE ALL ON FUNCTION public.update_facility_location(uuid,text,text,text,double precision,double precision) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_facility_location(uuid,text,text,text,double precision,double precision) TO authenticated;

-- A legacy master-invite path must not unlink real owned sites when switching a demo.
DO $$ DECLARE def text; BEGIN
  SELECT pg_get_functiondef('public.claim_facility_secure(uuid,text)'::regprocedure) INTO def;
  IF position('IF v_master_ok THEN' IN def)=0 THEN RAISE EXCEPTION 'claim guard anchor missing'; END IF;
  def:=replace(def,'IF v_master_ok THEN',$guard$IF v_master_ok THEN
    IF NOT coalesce(v_facility.is_demo,false) OR EXISTS(SELECT 1 FROM public.facilities WHERE admin_user_id=auth.uid() AND NOT coalesce(is_demo,false)) THEN
      RAISE EXCEPTION '실제 사업장 계정은 시연 소유권 전환을 사용할 수 없어요';
    END IF;$guard$);
  EXECUTE def;
END $$;
