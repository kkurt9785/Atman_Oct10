-- 사업장 기본 정보(이름·주소·전화)와 출퇴근 인증 위치(핀)를 관리자가 직접 고친다.
-- 셀프 등록 이후 핀이 잘못 찍힌 사업장이 스스로 바로잡는 경로. location은 워커 GPS 인증·근처 공고의 기준점.

CREATE OR REPLACE FUNCTION public.get_facility_location(p_facility_id uuid)
RETURNS TABLE (name text, address_text text, contact_phone text, lng double precision, lat double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.name, f.address_text, f.contact_phone,
         public.ST_X(f.location::public.geometry), public.ST_Y(f.location::public.geometry)
  FROM public.facilities AS f
  WHERE f.id = p_facility_id AND f.deleted_at IS NULL
    AND public.can_manage_facility(p_facility_id, ARRAY['owner','operator','super','sales']::text[]);
$$;
REVOKE ALL ON FUNCTION public.get_facility_location(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_facility_location(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_facility_location(
  p_facility_id uuid, p_name text, p_address_text text, p_phone text,
  p_lng double precision, p_lat double precision
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
BEGIN
  -- can_manage_facility는 접근 행이 없으면 NULL을 돌려준다. IF NOT NULL 은 통과하므로 반드시 IS DISTINCT FROM true 로 검사.
  IF public.can_manage_facility(p_facility_id, ARRAY['owner','operator','super']::text[]) IS DISTINCT FROM true THEN
    RAISE EXCEPTION '이 사업장을 수정할 권한이 없어요';
  END IF;
  IF char_length(btrim(p_name)) < 2 OR char_length(btrim(p_name)) > 100 THEN RAISE EXCEPTION '사업장명을 확인해 주세요'; END IF;
  IF char_length(btrim(p_address_text)) < 5 THEN RAISE EXCEPTION '주소를 확인해 주세요'; END IF;
  IF p_lng IS NULL OR p_lat IS NULL OR p_lng NOT BETWEEN 124 AND 132 OR p_lat NOT BETWEEN 33 AND 39 THEN
    RAISE EXCEPTION '사업장 위치를 지도에서 확인해 주세요';
  END IF;

  SELECT jsonb_build_object('name', f.name, 'address_text', f.address_text, 'contact_phone', f.contact_phone,
                            'lng', public.ST_X(f.location::public.geometry), 'lat', public.ST_Y(f.location::public.geometry))
    INTO v_before FROM public.facilities AS f WHERE f.id = p_facility_id;

  UPDATE public.facilities SET
    name = btrim(p_name),
    address_text = btrim(p_address_text),
    contact_phone = NULLIF(btrim(p_phone), ''),
    location = public.ST_SetSRID(public.ST_MakePoint(p_lng, p_lat), 4326)::public.geography,
    updated_at = now()
  WHERE id = p_facility_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '사업장을 찾을 수 없어요'; END IF;

  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, before_data, after_data)
  VALUES ('admin', auth.uid(), 'facility.location.update', 'facility', p_facility_id, v_before,
          jsonb_build_object('name', btrim(p_name), 'address_text', btrim(p_address_text), 'contact_phone', NULLIF(btrim(p_phone), ''), 'lng', p_lng, 'lat', p_lat));
END;
$$;
REVOKE ALL ON FUNCTION public.update_facility_location(uuid,text,text,text,double precision,double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_facility_location(uuid,text,text,text,double precision,double precision) TO authenticated;

SELECT (SELECT count(*) FROM pg_proc WHERE proname IN ('get_facility_location','update_facility_location')) AS rpc_2;
