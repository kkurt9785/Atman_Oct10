-- 사업장 셀프 등록: 심평원(HIRA) 요양기관 검색 → 즉시 등록.
-- approved_at IS NULL = 잇닿 승인 대기 (승인 전 공고 등록 차단은 앱에서 처리).

ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS hira_ykiho text,
  ADD COLUMN IF NOT EXISTS hira_cl_cd text,
  ADD COLUMN IF NOT EXISTS registration_source text NOT NULL DEFAULT 'invite';
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_registration_source_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_registration_source_check
  CHECK (registration_source IN ('invite', 'self_hira', 'self_kakao', 'demo'));
UPDATE public.facilities SET registration_source = 'demo' WHERE is_demo = true AND registration_source = 'invite';
CREATE UNIQUE INDEX IF NOT EXISTS uq_facilities_hira_ykiho
  ON public.facilities (hira_ykiho) WHERE hira_ykiho IS NOT NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.register_facility_self(
  p_name text,
  p_facility_type text,
  p_address_text text,
  p_lng double precision,
  p_lat double precision,
  p_phone text DEFAULT NULL,
  p_hira_ykiho text DEFAULT NULL,
  p_hira_cl_cd text DEFAULT NULL,
  p_bed_count integer DEFAULT NULL,
  p_source text DEFAULT 'self_hira'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_is_admin boolean;
  v_name text := btrim(p_name);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') INTO v_is_admin;
  IF NOT v_is_admin THEN RAISE EXCEPTION '관리자 계정만 사업장을 등록할 수 있어요'; END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 100 THEN RAISE EXCEPTION '사업장명을 확인해 주세요'; END IF;
  IF p_facility_type NOT IN ('small_hospital','general_hospital','care_hospital','pharmacy','nursing_home','home_health') THEN
    RAISE EXCEPTION '사업장 유형을 확인해 주세요';
  END IF;
  IF p_lng IS NULL OR p_lat IS NULL OR p_lng NOT BETWEEN 124 AND 132 OR p_lat NOT BETWEEN 33 AND 39 THEN
    RAISE EXCEPTION '사업장 위치를 지도에서 확인해 주세요';
  END IF;
  IF p_source NOT IN ('self_hira', 'self_kakao') THEN RAISE EXCEPTION '등록 경로가 올바르지 않아요'; END IF;
  IF p_hira_ykiho IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.facilities WHERE hira_ykiho = p_hira_ykiho AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '이미 잇닿에 등록된 사업장이에요. 초대 코드로 연결하거나 잇닿에 문의해 주세요.';
  END IF;
  -- admin_user_id UNIQUE: 관리자 1명이 소유하는 사업장은 1개. 추가 사업장은 facility_admin_access로 연결한다.
  IF EXISTS (SELECT 1 FROM public.facilities WHERE admin_user_id = auth.uid() AND deleted_at IS NULL) THEN
    RAISE EXCEPTION '이미 운영 중인 사업장이 있어요. 추가 사업장 연결은 잇닿에 문의해 주세요.';
  END IF;

  INSERT INTO public.facilities (
    name, facility_type, business_registration_number, address_text, location, contact_phone,
    admin_user_id, is_active, approved_at, hira_ykiho, hira_cl_cd, registration_source, bed_count, plan_code, is_demo
  ) VALUES (
    v_name, p_facility_type,
    -- 사업자등록번호는 승인 단계에서 실제 번호로 교체. 유니크 충돌 방지용 임시값.
    'SELF-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10)),
    btrim(p_address_text),
    public.ST_SetSRID(public.ST_MakePoint(p_lng, p_lat), 4326)::public.geography,
    NULLIF(btrim(p_phone), ''),
    auth.uid(), true, NULL, NULLIF(btrim(p_hira_ykiho), ''), NULLIF(btrim(p_hira_cl_cd), ''), p_source, p_bed_count,
    CASE WHEN p_facility_type = 'pharmacy' THEN 'pharmacy' ELSE 'clinic' END,
    false
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_facility_self(text,text,text,double precision,double precision,text,text,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_facility_self(text,text,text,double precision,double precision,text,text,text,integer,text) TO authenticated;

-- 검색 병합용: 심평원 결과 중 이미 잇닿에 등록된 기관을 찾는다 (초대코드 연결 안내). 이름·주소 등은 노출하지 않음.
CREATE OR REPLACE FUNCTION public.find_registered_hira_facilities(p_ykihos text[])
RETURNS TABLE (hira_ykiho text, facility_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.hira_ykiho, f.id
  FROM public.facilities AS f
  JOIN public.profiles AS p ON p.id = auth.uid() AND p.role = 'admin'
  WHERE f.hira_ykiho = ANY (p_ykihos) AND f.deleted_at IS NULL AND f.is_active = true;
$$;
REVOKE ALL ON FUNCTION public.find_registered_hira_facilities(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_registered_hira_facilities(text[]) TO authenticated;

-- 검증: 컬럼·인덱스·함수 존재
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='facilities' AND column_name IN ('hira_ykiho','hira_cl_cd','registration_source')) AS new_columns_3,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='uq_facilities_hira_ykiho') AS ykiho_index_1,
  (SELECT count(*) FROM pg_proc WHERE proname IN ('register_facility_self','find_registered_hira_facilities')) AS rpc_2;
