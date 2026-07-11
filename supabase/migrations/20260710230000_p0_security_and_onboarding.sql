-- ============================================================================
-- P0 production hardening (1/3)
--   * authenticated identity helpers
--   * facility claim hardening
--   * least-privilege RLS
--   * private license storage
--   * atomic worker onboarding / profile / bank updates
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared authorization helpers. SECURITY DEFINER functions use an empty
-- search_path and fully-qualified object names to avoid object-shadowing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.current_worker_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT w.id
  FROM public.workers AS w
  WHERE w.auth_user_id = auth.uid()
    AND w.deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.facility_access_role(p_facility_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN f.admin_user_id = auth.uid() THEN 'owner'
    ELSE faa.access_role
  END
  FROM public.facilities AS f
  LEFT JOIN public.facility_admin_access AS faa
    ON faa.facility_id = f.id
   AND faa.user_id = auth.uid()
  WHERE f.id = p_facility_id
    AND f.is_active = true
    AND f.deleted_at IS NULL
    AND (f.admin_user_id = auth.uid() OR faa.user_id IS NOT NULL)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_facility(
  p_facility_id uuid,
  p_allowed_roles text[] DEFAULT ARRAY['owner','operator','super']::text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.facility_access_role(p_facility_id) = ANY (p_allowed_roles);
$$;

REVOKE ALL ON FUNCTION public.is_service_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_worker_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.facility_access_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_facility(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_worker_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.facility_access_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_facility(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_service_role() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Facility claim: hash invite codes, expire them, and rate-limit guesses.
-- ---------------------------------------------------------------------------
ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS invite_code_hash text,
  ADD COLUMN IF NOT EXISTS invite_code_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_code_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invite_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_geofence_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS attendance_geofence_meters integer NOT NULL DEFAULT 500
    CHECK (attendance_geofence_meters BETWEEN 50 AND 5000);

UPDATE public.facilities
SET invite_code_hash = public.crypt(upper(trim(invite_code)), public.gen_salt('bf')),
    invite_code_expires_at = COALESCE(invite_code_expires_at, now() + interval '30 days')
WHERE invite_code_hash IS NULL
  AND invite_code IS NOT NULL
  AND trim(invite_code) <> '';

-- Never retain the plaintext invite code after the bcrypt migration.
UPDATE public.facilities
SET invite_code = NULL
WHERE invite_code_hash IS NOT NULL
  AND invite_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.search_claimable_facilities(p_query text)
RETURNS TABLE (
  id uuid,
  name text,
  facility_type text,
  address_text text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.id, f.name, f.facility_type, f.address_text
  FROM public.facilities AS f
  JOIN public.profiles AS p ON p.id = auth.uid() AND p.role = 'admin'
  WHERE length(trim(p_query)) >= 2
    AND f.name ILIKE '%' || trim(p_query) || '%'
    AND f.admin_user_id IS NULL
    AND f.is_active = true
    AND f.deleted_at IS NULL
    AND f.invite_code_hash IS NOT NULL
    AND (f.invite_code_expires_at IS NULL OR f.invite_code_expires_at > now())
  ORDER BY f.name
  LIMIT 20;
$$;

CREATE OR REPLACE FUNCTION public.claim_facility_secure(
  p_facility_id uuid,
  p_invite_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_facility public.facilities%ROWTYPE;
  v_is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION '관리자 계정만 병원을 연결할 수 있어요';
  END IF;

  SELECT * INTO v_facility
  FROM public.facilities
  WHERE id = p_facility_id
    AND is_active = true
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '병원을 찾을 수 없어요';
  END IF;
  IF v_facility.admin_user_id IS NOT NULL AND v_facility.admin_user_id <> auth.uid() THEN
    RAISE EXCEPTION '이미 다른 계정에서 연결된 병원이에요';
  END IF;
  IF v_facility.invite_locked_until IS NOT NULL AND v_facility.invite_locked_until > now() THEN
    RAISE EXCEPTION '초대 코드 입력이 잠시 잠겼어요. 나중에 다시 시도해 주세요';
  END IF;
  IF v_facility.invite_code_hash IS NULL
     OR (v_facility.invite_code_expires_at IS NOT NULL AND v_facility.invite_code_expires_at <= now()) THEN
    RAISE EXCEPTION '초대 코드가 만료됐어요. 새 코드를 요청해 주세요';
  END IF;

  IF public.crypt(upper(trim(p_invite_code)), v_facility.invite_code_hash) <> v_facility.invite_code_hash THEN
    UPDATE public.facilities
    SET invite_failed_attempts = invite_failed_attempts + 1,
        invite_locked_until = CASE
          WHEN invite_failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
          ELSE invite_locked_until
        END
    WHERE id = p_facility_id;
    RAISE EXCEPTION '초대 코드가 올바르지 않아요';
  END IF;

  UPDATE public.facilities
  SET admin_user_id = auth.uid(),
      invite_code = NULL,
      invite_code_used_at = now(),
      invite_failed_attempts = 0,
      invite_locked_until = NULL,
      updated_at = now()
  WHERE id = p_facility_id;

  INSERT INTO public.credit_ledger (org_id, delta, kind, ref, expires_at)
  SELECT p_facility_id, 30000, 'onboard_signup', 'facility-claim', NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.credit_ledger
    WHERE org_id = p_facility_id AND kind = 'onboard_signup'
  );

  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, after_data
  ) VALUES (
    'admin', auth.uid(), 'facility.claim', 'facility', p_facility_id,
    jsonb_build_object('admin_user_id', auth.uid())
  );

  RETURN p_facility_id;
END;
$$;

REVOKE ALL ON FUNCTION public.search_claimable_facilities(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_facility_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_claimable_facilities(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_facility_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Bank encryption must fail closed. Configure app.bank_encryption_key or a
-- Supabase Vault secret named bank_encryption_key before running onboarding.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bank_encryption_key()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := nullif(current_setting('app.bank_encryption_key', true), '');

  IF v_key IS NULL THEN
    BEGIN
      EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_key
      USING 'bank_encryption_key';
    EXCEPTION
      WHEN undefined_table OR invalid_schema_name OR undefined_column THEN
        v_key := NULL;
    END;
  END IF;

  IF v_key IS NULL OR length(v_key) < 32 THEN
    RAISE EXCEPTION 'bank_encryption_key is not configured';
  END IF;
  RETURN v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.bank_encryption_key() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.upsert_my_bank_account(
  p_bank_code text,
  p_bank_name text,
  p_account_number text,
  p_account_holder_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_account text := regexp_replace(COALESCE(p_account_number, ''), '[^0-9]', '', 'g');
BEGIN
  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION '워커 정보를 찾을 수 없어요';
  END IF;
  IF length(trim(COALESCE(p_bank_code, ''))) < 1 OR length(trim(COALESCE(p_bank_name, ''))) < 1 THEN
    RAISE EXCEPTION '은행을 선택해 주세요';
  END IF;
  IF length(v_account) NOT BETWEEN 8 AND 20 THEN
    RAISE EXCEPTION '계좌번호를 다시 확인해 주세요';
  END IF;
  IF length(trim(COALESCE(p_account_holder_name, ''))) < 2 THEN
    RAISE EXCEPTION '예금주 이름을 확인해 주세요';
  END IF;

  UPDATE public.worker_bank_accounts
  SET is_primary = false,
      deleted_at = COALESCE(deleted_at, now())
  WHERE worker_id = v_worker_id
    AND is_primary = true
    AND deleted_at IS NULL;

  INSERT INTO public.worker_bank_accounts (
    worker_id, bank_code, bank_name, account_number_encrypted,
    account_number_last4, account_holder_name, verification_status,
    is_primary
  ) VALUES (
    v_worker_id,
    trim(p_bank_code),
    trim(p_bank_name),
    public.pgp_sym_encrypt(v_account, public.bank_encryption_key()),
    right(v_account, 4),
    trim(p_account_holder_name),
    'pending',
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_my_bank_account(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_my_bank_account(text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Atomic onboarding and resumable draft.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.worker_onboarding_drafts (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.worker_onboarding_drafts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_onboarding_drafts TO authenticated;

DROP POLICY IF EXISTS worker_onboarding_draft_select ON public.worker_onboarding_drafts;
DROP POLICY IF EXISTS worker_onboarding_draft_insert ON public.worker_onboarding_drafts;
DROP POLICY IF EXISTS worker_onboarding_draft_update ON public.worker_onboarding_drafts;
DROP POLICY IF EXISTS worker_onboarding_draft_delete ON public.worker_onboarding_drafts;
CREATE POLICY worker_onboarding_draft_select ON public.worker_onboarding_drafts
  FOR SELECT USING (auth_user_id = auth.uid());
CREATE POLICY worker_onboarding_draft_insert ON public.worker_onboarding_drafts
  FOR INSERT WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY worker_onboarding_draft_update ON public.worker_onboarding_drafts
  FOR UPDATE USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY worker_onboarding_draft_delete ON public.worker_onboarding_drafts
  FOR DELETE USING (auth_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.save_my_onboarding_draft(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  IF pg_column_size(COALESCE(p_payload, '{}'::jsonb)) > 65536 THEN
    RAISE EXCEPTION '임시 저장 데이터가 너무 커요';
  END IF;

  INSERT INTO public.worker_onboarding_drafts (auth_user_id, payload, updated_at)
  VALUES (auth.uid(), COALESCE(p_payload, '{}'::jsonb), now())
  ON CONFLICT (auth_user_id) DO UPDATE
  SET payload = EXCLUDED.payload, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_worker_onboarding(
  p_role text,
  p_name text,
  p_phone text,
  p_birth_date date,
  p_areas jsonb,
  p_license_path text,
  p_bank_code text,
  p_bank_name text,
  p_account_number text,
  p_account_holder_name text,
  p_consents jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid;
  v_user auth.users%ROWTYPE;
  v_primary jsonb;
  v_license_exists boolean;
  v_required_count integer;
  v_kakao_id text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  IF p_role NOT IN ('rn','na') THEN RAISE EXCEPTION '직군을 다시 선택해 주세요'; END IF;
  IF length(trim(COALESCE(p_name, ''))) < 2 THEN RAISE EXCEPTION '실명을 입력해 주세요'; END IF;
  IF p_birth_date IS NULL OR p_birth_date > current_date - interval '18 years' THEN
    RAISE EXCEPTION '만 18세 이상만 가입할 수 있어요';
  END IF;
  IF p_birth_date < current_date - interval '100 years' THEN
    RAISE EXCEPTION '생년월일을 다시 확인해 주세요';
  END IF;
  IF regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') !~ '^010[0-9]{8}$' THEN
    RAISE EXCEPTION '휴대폰 번호를 다시 확인해 주세요';
  END IF;
  IF jsonb_typeof(COALESCE(p_areas, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_areas, '[]'::jsonb)) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION '활동 지역을 1~2개 선택해 주세요';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_areas) AS item
    WHERE length(trim(COALESCE(item->>'label', ''))) < 2
       OR COALESCE(item->>'lat', '') !~ '^-?[0-9]+([.][0-9]+)?$'
       OR COALESCE(item->>'lng', '') !~ '^-?[0-9]+([.][0-9]+)?$'
       OR (item->>'lat')::double precision NOT BETWEEN -90 AND 90
       OR (item->>'lng')::double precision NOT BETWEEN -180 AND 180
       OR COALESCE(item->>'radius_km', '') !~ '^[0-9]+([.][0-9]+)?$'
       OR (item->>'radius_km')::double precision NOT BETWEEN 1 AND 30
  ) THEN
    RAISE EXCEPTION '활동 지역 좌표 또는 반경이 올바르지 않아요';
  END IF;
  IF jsonb_typeof(COALESCE(p_consents, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION '약관 동의 정보가 올바르지 않아요';
  END IF;

  SELECT count(DISTINCT item->>'type') INTO v_required_count
  FROM jsonb_array_elements(p_consents) AS item
  WHERE item->>'type' IN ('age_over_18','terms_of_service','privacy_policy','location_data')
    AND COALESCE((item->>'granted')::boolean, false) = true
    AND length(COALESCE(item->>'version', '')) > 0;
  IF v_required_count <> 4 THEN
    RAISE EXCEPTION '필수 약관 동의가 필요해요';
  END IF;

  SELECT * INTO v_user FROM auth.users WHERE id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION '사용자 정보를 찾을 수 없어요'; END IF;
  v_kakao_id := COALESCE(
    NULLIF(v_user.raw_user_meta_data->>'provider_id', ''),
    NULLIF(v_user.raw_user_meta_data->>'sub', ''),
    auth.uid()::text
  );
  v_primary := p_areas->0;

  IF p_license_path IS NOT NULL THEN
    IF split_part(p_license_path, '/', 1) <> auth.uid()::text THEN
      RAISE EXCEPTION '면허 파일 경로가 올바르지 않아요';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'license-photos' AND name = p_license_path
    ) INTO v_license_exists;
    IF NOT v_license_exists THEN
      RAISE EXCEPTION '업로드된 면허 파일을 찾을 수 없어요';
    END IF;
  END IF;

  INSERT INTO public.workers (
    auth_user_id, kakao_id, name, phone, email, birth_date, role,
    verification_status, license_photo_url, activity_center,
    activity_radius_meters, activity_address_text
  ) VALUES (
    auth.uid(), v_kakao_id, trim(p_name), p_phone, v_user.email, p_birth_date, p_role,
    CASE WHEN p_license_path IS NULL THEN 'pending' ELSE 'reviewing' END,
    p_license_path,
    public.ST_SetSRID(public.ST_MakePoint(
      (v_primary->>'lng')::double precision,
      (v_primary->>'lat')::double precision
    ), 4326)::public.geography,
    LEAST(30000, GREATEST(1000, round(COALESCE((v_primary->>'radius_km')::numeric, 5) * 1000)::integer)),
    v_primary->>'label'
  )
  ON CONFLICT (auth_user_id) DO UPDATE SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    birth_date = EXCLUDED.birth_date,
    role = EXCLUDED.role,
    verification_status = CASE
      WHEN public.workers.verification_status = 'approved' THEN 'approved'
      ELSE EXCLUDED.verification_status
    END,
    license_photo_url = COALESCE(EXCLUDED.license_photo_url, public.workers.license_photo_url),
    activity_center = EXCLUDED.activity_center,
    activity_radius_meters = EXCLUDED.activity_radius_meters,
    activity_address_text = EXCLUDED.activity_address_text,
    updated_at = now(),
    deleted_at = NULL
  RETURNING id INTO v_worker_id;

  INSERT INTO public.worker_location_prefs (worker_id, locations, updated_at)
  VALUES (auth.uid(), p_areas, now())
  ON CONFLICT (worker_id) DO UPDATE
  SET locations = EXCLUDED.locations, updated_at = now();

  IF p_license_path IS NOT NULL THEN
    INSERT INTO public.worker_credentials (
      worker_id, credential_type, document_url, verification_status
    )
    SELECT
      v_worker_id,
      CASE WHEN p_role = 'rn' THEN 'nursing_license' ELSE 'na_certificate' END,
      p_license_path,
      'pending'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.worker_credentials
      WHERE worker_id = v_worker_id AND document_url = p_license_path
    );
  END IF;

  PERFORM public.upsert_my_bank_account(
    p_bank_code, p_bank_name, p_account_number,
    COALESCE(NULLIF(trim(p_account_holder_name), ''), trim(p_name))
  );

  INSERT INTO public.worker_consents (
    worker_id, consent_type, version, granted, granted_at
  )
  SELECT
    v_worker_id,
    item->>'type',
    item->>'version',
    COALESCE((item->>'granted')::boolean, false),
    now()
  FROM jsonb_array_elements(p_consents) AS item
  WHERE item->>'type' IN (
    'age_over_18','terms_of_service','privacy_policy','location_data','marketing'
  );

  UPDATE public.profiles
  SET role = 'worker', onboarding_done = true, updated_at = now()
  WHERE id = auth.uid();

  DELETE FROM public.worker_onboarding_drafts WHERE auth_user_id = auth.uid();

  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, after_data
  ) VALUES (
    'worker', auth.uid(), 'worker.onboarding.complete', 'worker', v_worker_id,
    jsonb_build_object('role', p_role, 'license_uploaded', p_license_path IS NOT NULL)
  );

  RETURN v_worker_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_worker_profile(
  p_license_number text,
  p_license_path text,
  p_experience_years text,
  p_last_workplace text,
  p_department_tags text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_license_exists boolean;
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;
  IF p_license_path IS NOT NULL THEN
    IF split_part(p_license_path, '/', 1) <> auth.uid()::text THEN
      RAISE EXCEPTION '면허 파일 경로가 올바르지 않아요';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'license-photos' AND name = p_license_path
    ) INTO v_license_exists;
    IF NOT v_license_exists THEN RAISE EXCEPTION '면허 파일을 찾을 수 없어요'; END IF;
  END IF;

  UPDATE public.workers
  SET license_number = NULLIF(trim(p_license_number), ''),
      license_photo_url = p_license_path,
      experience_years = NULLIF(trim(p_experience_years), ''),
      last_workplace = NULLIF(trim(p_last_workplace), ''),
      department_tags = COALESCE(p_department_tags, '{}'::text[]),
      verification_status = CASE
        WHEN p_license_path IS DISTINCT FROM license_photo_url THEN 'reviewing'
        ELSE verification_status
      END,
      updated_at = now()
  WHERE id = v_worker_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_onboarding_draft(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_worker_onboarding(text,text,text,date,jsonb,text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_my_worker_profile(text,text,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_my_onboarding_draft(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_worker_onboarding(text,text,text,date,jsonb,text,text,text,text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_worker_profile(text,text,text,text,text[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Private license bucket and owner-scoped storage access.
-- ---------------------------------------------------------------------------
UPDATE public.workers
SET license_photo_url = split_part(license_photo_url, '/storage/v1/object/public/license-photos/', 2)
WHERE license_photo_url LIKE '%/storage/v1/object/public/license-photos/%';

UPDATE public.worker_credentials
SET document_url = split_part(document_url, '/storage/v1/object/public/license-photos/', 2)
WHERE document_url LIKE '%/storage/v1/object/public/license-photos/%';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'license-photos', 'license-photos', false, 10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS license_photos_select_own ON storage.objects;
DROP POLICY IF EXISTS license_photos_insert_own ON storage.objects;
DROP POLICY IF EXISTS license_photos_update_own ON storage.objects;
DROP POLICY IF EXISTS license_photos_delete_own ON storage.objects;
CREATE POLICY license_photos_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'license-photos' AND split_part(name, '/', 1) = auth.uid()::text);
CREATE POLICY license_photos_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'license-photos' AND split_part(name, '/', 1) = auth.uid()::text);
CREATE POLICY license_photos_update_own ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'license-photos' AND split_part(name, '/', 1) = auth.uid()::text)
  WITH CHECK (bucket_id = 'license-photos' AND split_part(name, '/', 1) = auth.uid()::text);
CREATE POLICY license_photos_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'license-photos' AND split_part(name, '/', 1) = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Least-privilege table policies. Direct client writes to workflow, financial,
-- credential, bank and attendance tables are revoked; RPCs are the write path.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS workers_insert_own ON public.workers;
DROP POLICY IF EXISTS workers_update_own ON public.workers;
DROP POLICY IF EXISTS workers_select_own ON public.workers;
CREATE POLICY workers_select_own ON public.workers
  FOR SELECT USING (auth_user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.workers FROM authenticated;

DROP POLICY IF EXISTS credentials_own ON public.worker_credentials;
CREATE POLICY credentials_select_own ON public.worker_credentials
  FOR SELECT USING (worker_id = public.current_worker_id());
REVOKE INSERT, UPDATE, DELETE ON public.worker_credentials FROM authenticated;

DROP POLICY IF EXISTS bank_own ON public.worker_bank_accounts;
CREATE POLICY bank_select_own ON public.worker_bank_accounts
  FOR SELECT USING (worker_id = public.current_worker_id());
REVOKE INSERT, UPDATE, DELETE ON public.worker_bank_accounts FROM authenticated;

DROP POLICY IF EXISTS consents_insert ON public.worker_consents;
DROP POLICY IF EXISTS consents_select ON public.worker_consents;
CREATE POLICY consents_select_own ON public.worker_consents
  FOR SELECT USING (worker_id = public.current_worker_id());
REVOKE INSERT, UPDATE, DELETE ON public.worker_consents FROM authenticated;

DROP POLICY IF EXISTS "location_prefs: 본인 전체" ON public.worker_location_prefs;
CREATE POLICY location_prefs_select_own ON public.worker_location_prefs
  FOR SELECT USING (worker_id = auth.uid());
CREATE POLICY location_prefs_insert_own ON public.worker_location_prefs
  FOR INSERT WITH CHECK (worker_id = auth.uid());
CREATE POLICY location_prefs_update_own ON public.worker_location_prefs
  FOR UPDATE USING (worker_id = auth.uid()) WITH CHECK (worker_id = auth.uid());
CREATE POLICY location_prefs_delete_own ON public.worker_location_prefs
  FOR DELETE USING (worker_id = auth.uid());

DROP POLICY IF EXISTS push_subscriptions_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions
  FOR SELECT USING (worker_id = auth.uid());
CREATE POLICY push_subscriptions_insert_own ON public.push_subscriptions
  FOR INSERT WITH CHECK (worker_id = auth.uid());
CREATE POLICY push_subscriptions_update_own ON public.push_subscriptions
  FOR UPDATE USING (worker_id = auth.uid()) WITH CHECK (worker_id = auth.uid());
CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions
  FOR DELETE USING (worker_id = auth.uid());

DROP POLICY IF EXISTS applications_worker ON public.shift_applications;
DROP POLICY IF EXISTS applications_facility_read ON public.shift_applications;
CREATE POLICY applications_select_worker ON public.shift_applications
  FOR SELECT USING (worker_id = public.current_worker_id());
CREATE POLICY applications_select_facility ON public.shift_applications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_id AND public.facility_access_role(s.facility_id) IS NOT NULL
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.shift_applications FROM authenticated;

DROP POLICY IF EXISTS attendances_worker ON public.shift_attendances;
CREATE POLICY attendances_select_worker ON public.shift_attendances
  FOR SELECT USING (worker_id = public.current_worker_id());
CREATE POLICY attendances_select_facility ON public.shift_attendances
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_id AND public.facility_access_role(s.facility_id) IS NOT NULL
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.shift_attendances FROM authenticated;

DROP POLICY IF EXISTS org_admin_wage_calculations ON public.wage_calculations;
DROP POLICY IF EXISTS worker_read_wage_calculations ON public.wage_calculations;
CREATE POLICY wage_calculations_select_worker ON public.wage_calculations
  FOR SELECT USING (worker_id = public.current_worker_id());
CREATE POLICY wage_calculations_select_facility ON public.wage_calculations
  FOR SELECT USING (public.facility_access_role(org_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.wage_calculations FROM authenticated;

DROP POLICY IF EXISTS org_admin_payroll_ledger ON public.payroll_ledger;
DROP POLICY IF EXISTS worker_read_payroll_ledger ON public.payroll_ledger;
CREATE POLICY payroll_ledger_select_worker ON public.payroll_ledger
  FOR SELECT USING (worker_id = public.current_worker_id());
CREATE POLICY payroll_ledger_select_facility ON public.payroll_ledger
  FOR SELECT USING (public.facility_access_role(org_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.payroll_ledger FROM authenticated;

DROP POLICY IF EXISTS org_admin_payslips ON public.payslips;
DROP POLICY IF EXISTS worker_read_payslips ON public.payslips;
CREATE POLICY payslips_select_worker ON public.payslips
  FOR SELECT USING (worker_id = public.current_worker_id());
CREATE POLICY payslips_select_facility ON public.payslips
  FOR SELECT USING (public.facility_access_role(org_id) IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.payslips FROM authenticated;

DROP POLICY IF EXISTS settlements_worker_read ON public.settlements;
CREATE POLICY settlements_select_worker ON public.settlements
  FOR SELECT USING (worker_id = public.current_worker_id());
CREATE POLICY settlements_select_facility ON public.settlements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      WHERE s.id = shift_id AND public.facility_access_role(s.facility_id) IS NOT NULL
    )
  );
REVOKE INSERT, UPDATE, DELETE ON public.settlements FROM authenticated;

DROP POLICY IF EXISTS "profiles: 본인 수정" ON public.profiles;
REVOKE UPDATE ON public.profiles FROM authenticated;

-- Old insecure discovery RPC signatures must no longer be callable.
REVOKE EXECUTE ON FUNCTION public.get_nearby_open_shifts_v2(uuid, text[], double precision, double precision, text[]) FROM authenticated, anon, PUBLIC;

-- ---------------------------------------------------------------------------
-- Follow-up: profile and activity-area updates remain RPC-only after direct
-- workers UPDATE was revoked above.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_my_activity_areas(p_areas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_primary jsonb;
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;
  IF jsonb_typeof(COALESCE(p_areas, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_areas, '[]'::jsonb)) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION '활동 지역을 1~2개 선택해 주세요';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_areas) AS item
    WHERE length(trim(COALESCE(item->>'label', ''))) < 2
       OR (item->>'lat') IS NULL
       OR (item->>'lng') IS NULL
       OR (item->>'lat')::double precision NOT BETWEEN -90 AND 90
       OR (item->>'lng')::double precision NOT BETWEEN -180 AND 180
       OR COALESCE((item->>'radius_km')::double precision, 0) NOT BETWEEN 1 AND 30
  ) THEN
    RAISE EXCEPTION '활동 지역 좌표 또는 반경이 올바르지 않아요';
  END IF;

  v_primary := p_areas->0;
  INSERT INTO public.worker_location_prefs (worker_id, locations, updated_at)
  VALUES (auth.uid(), p_areas, now())
  ON CONFLICT (worker_id) DO UPDATE
  SET locations = EXCLUDED.locations, updated_at = now();

  UPDATE public.workers
  SET activity_center = public.ST_SetSRID(public.ST_MakePoint(
        (v_primary->>'lng')::double precision,
        (v_primary->>'lat')::double precision
      ), 4326)::public.geography,
      activity_radius_meters = round((v_primary->>'radius_km')::numeric * 1000)::integer,
      activity_address_text = trim(v_primary->>'label'),
      updated_at = now()
  WHERE id = v_worker_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_worker_profile(
  p_license_number text,
  p_license_path text,
  p_experience_years text,
  p_last_workplace text,
  p_department_tags text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_worker_role text;
  v_license_exists boolean;
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;
  IF NULLIF(trim(COALESCE(p_license_number, '')), '') IS NULL AND p_license_path IS NULL THEN
    RAISE EXCEPTION '면허 번호 또는 면허 사진이 필요해요';
  END IF;
  IF length(trim(COALESCE(p_experience_years, ''))) < 1 THEN RAISE EXCEPTION '경력을 선택해 주세요'; END IF;
  IF length(trim(COALESCE(p_last_workplace, ''))) < 2 THEN RAISE EXCEPTION '최근 근무지를 확인해 주세요'; END IF;
  IF COALESCE(array_length(p_department_tags, 1), 0) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION '부서 태그를 1개 이상 선택해 주세요';
  END IF;

  IF p_license_path IS NOT NULL THEN
    IF split_part(p_license_path, '/', 1) <> auth.uid()::text THEN
      RAISE EXCEPTION '면허 파일 경로가 올바르지 않아요';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'license-photos' AND name = p_license_path
    ) INTO v_license_exists;
    IF NOT v_license_exists THEN RAISE EXCEPTION '면허 파일을 찾을 수 없어요'; END IF;
  END IF;

  SELECT role INTO v_worker_role FROM public.workers WHERE id = v_worker_id;
  UPDATE public.workers
  SET license_number = NULLIF(trim(COALESCE(p_license_number, '')), ''),
      license_photo_url = p_license_path,
      experience_years = trim(p_experience_years),
      last_workplace = trim(p_last_workplace),
      department_tags = p_department_tags,
      verification_status = CASE
        WHEN license_number IS DISTINCT FROM NULLIF(trim(COALESCE(p_license_number, '')), '')
          OR license_photo_url IS DISTINCT FROM p_license_path
        THEN 'reviewing'
        ELSE verification_status
      END,
      updated_at = now()
  WHERE id = v_worker_id;

  IF p_license_path IS NOT NULL THEN
    INSERT INTO public.worker_credentials (
      worker_id, credential_type, document_url, verification_status
    )
    SELECT
      v_worker_id,
      CASE WHEN v_worker_role = 'rn' THEN 'nursing_license' ELSE 'na_certificate' END,
      p_license_path,
      'pending'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.worker_credentials
      WHERE worker_id = v_worker_id AND document_url = p_license_path
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_activity_areas(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_my_worker_profile(text,text,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_activity_areas(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_worker_profile(text,text,text,text,text[]) TO authenticated;
