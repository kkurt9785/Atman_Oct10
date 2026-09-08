-- 사업장 셀프 등록 시 사업자등록번호(텍스트)·사업자등록증(사진/PDF) 제출. 승인 전(approved_at NULL)에만 제출·수정.
ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS brn_submitted text,
  ADD COLUMN IF NOT EXISTS brn_document_path text;

-- 비공개 버킷: 경로는 <auth uid>/<facility id>/brn-<ts>.<ext>. 본인 폴더만 읽고 쓴다. 운영자는 서비스 역할로 서명 URL 발급.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('facility-documents', 'facility-documents', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS facility_documents_insert_own ON storage.objects;
DROP POLICY IF EXISTS facility_documents_select_own ON storage.objects;
DROP POLICY IF EXISTS facility_documents_update_own ON storage.objects;
DROP POLICY IF EXISTS facility_documents_delete_own ON storage.objects;
CREATE POLICY facility_documents_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'facility-documents' AND split_part(name, '/', 1) = auth.uid()::text);
CREATE POLICY facility_documents_select_own ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'facility-documents' AND split_part(name, '/', 1) = auth.uid()::text);
CREATE POLICY facility_documents_update_own ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'facility-documents' AND split_part(name, '/', 1) = auth.uid()::text);
CREATE POLICY facility_documents_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'facility-documents' AND split_part(name, '/', 1) = auth.uid()::text);

CREATE OR REPLACE FUNCTION public.submit_facility_brn_document(
  p_facility_id uuid, p_brn_submitted text DEFAULT NULL, p_document_path text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_brn_submitted, ''), '\D', '', 'g');
  v_brn text;
BEGIN
  IF public.can_manage_facility(p_facility_id, ARRAY['owner','operator','super']::text[]) IS DISTINCT FROM true THEN
    RAISE EXCEPTION '이 사업장을 수정할 권한이 없어요';
  END IF;
  IF v_digits <> '' AND length(v_digits) <> 10 THEN RAISE EXCEPTION '사업자등록번호는 숫자 10자리예요'; END IF;
  IF v_digits <> '' THEN v_brn := substr(v_digits,1,3) || '-' || substr(v_digits,4,2) || '-' || substr(v_digits,6,5); END IF;
  IF p_document_path IS NOT NULL AND position((auth.uid()::text || '/') IN p_document_path) <> 1 THEN
    RAISE EXCEPTION '서류 경로가 올바르지 않아요';
  END IF;
  UPDATE public.facilities SET
    brn_submitted = COALESCE(v_brn, brn_submitted),
    brn_document_path = COALESCE(p_document_path, brn_document_path),
    updated_at = now()
  WHERE id = p_facility_id AND deleted_at IS NULL AND approved_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '승인 대기 중인 사업장만 서류를 올릴 수 있어요'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_facility_brn_document(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_facility_brn_document(uuid,text,text) TO authenticated;

-- 심사 목록에 제출 번호·서류 경로 추가 (RETURNS TABLE 변경이라 DROP 후 재생성)
DROP FUNCTION IF EXISTS public.platform_list_self_registered_facilities(boolean);
CREATE FUNCTION public.platform_list_self_registered_facilities(p_pending_only boolean DEFAULT true)
RETURNS TABLE (
  id uuid, name text, facility_type text, address_text text, contact_phone text,
  hira_ykiho text, hira_cl_cd text, registration_source text, business_registration_number text,
  approved_at timestamptz, is_active boolean, created_at timestamptz,
  admin_user_id uuid, admin_email text, lng double precision, lat double precision,
  brn_submitted text, brn_document_path text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.id, f.name, f.facility_type, f.address_text, f.contact_phone,
         f.hira_ykiho, f.hira_cl_cd, f.registration_source, f.business_registration_number,
         f.approved_at, f.is_active, f.created_at,
         f.admin_user_id, u.email::text,
         public.ST_X(f.location::public.geometry), public.ST_Y(f.location::public.geometry),
         f.brn_submitted, f.brn_document_path
  FROM public.facilities AS f
  LEFT JOIN auth.users AS u ON u.id = f.admin_user_id
  WHERE f.registration_source IN ('self_hira', 'self_kakao')
    AND f.deleted_at IS NULL
    AND (NOT p_pending_only OR f.approved_at IS NULL)
  ORDER BY f.approved_at NULLS FIRST, f.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.platform_list_self_registered_facilities(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_list_self_registered_facilities(boolean) TO service_role;

SELECT (SELECT count(*) FROM storage.buckets WHERE id='facility-documents') bucket_1,
       (SELECT count(*) FROM pg_policies WHERE tablename='objects' AND policyname LIKE 'facility_documents_%') policies_4,
       (SELECT count(*) FROM pg_proc WHERE proname IN ('submit_facility_brn_document','platform_list_self_registered_facilities')) rpc_2;
