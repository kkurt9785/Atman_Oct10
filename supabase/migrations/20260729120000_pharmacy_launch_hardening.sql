-- Pharmacy launch hardening:
-- 1) backfill complete office-worker profiles,
-- 2) repair legacy credit idempotency conflict handling,
-- 3) accept authenticated facility registration requests.

UPDATE public.workers
SET verification_status='approved',
    verified_at=COALESCE(verified_at,now()),
    rejection_reason=NULL,
    updated_at=now()
WHERE role='pharmacy_staff'
  AND verification_status IN ('pending','reviewing')
  AND deleted_at IS NULL
  AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') ~ '^010[0-9]{8}$'
  AND birth_date IS NOT NULL
  AND length(trim(COALESCE(experience_years,''))) > 0
  AND length(trim(COALESCE(last_workplace,''))) >= 2
  AND COALESCE(array_length(department_tags,1),0) > 0;

-- credit_ledger uses a partial unique index, so the conflict predicate must
-- match it. This keeps the dormant legacy credit path safe if re-enabled.
DO $$
DECLARE
  fn regprocedure;
  def text;
BEGIN
  SELECT p.oid::regprocedure INTO fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='finalize_credit_payment'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF fn IS NOT NULL THEN
    SELECT pg_get_functiondef(fn) INTO def;
    def := replace(
      def,
      'ON CONFLICT (idempotency_key) DO NOTHING',
      'ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING'
    );
    EXECUTE def;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.facility_registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_type text NOT NULL CHECK (facility_type IN (
    'care_hospital','general_hospital','small_hospital','nursing_home',
    'home_health','pharmacy'
  )),
  facility_name text NOT NULL CHECK (char_length(facility_name) BETWEEN 2 AND 100),
  address_text text NOT NULL CHECK (char_length(address_text) BETWEEN 5 AND 300),
  contact_name text NOT NULL CHECK (char_length(contact_name) BETWEEN 2 AND 50),
  contact_phone text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','reviewing','approved','rejected','duplicate')),
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_registration_requests_status_created
  ON public.facility_registration_requests(status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_facility_registration_request_pending
  ON public.facility_registration_requests(requested_by,facility_type,lower(facility_name))
  WHERE status IN ('pending','reviewing');

ALTER TABLE public.facility_registration_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_registration_requests_select_own
  ON public.facility_registration_requests;
CREATE POLICY facility_registration_requests_select_own
  ON public.facility_registration_requests
  FOR SELECT TO authenticated
  USING (requested_by=auth.uid());

CREATE OR REPLACE FUNCTION public.submit_facility_registration_request(
  p_facility_type text,
  p_facility_name text,
  p_address_text text,
  p_contact_name text,
  p_contact_phone text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요해요'; END IF;
  IF p_facility_type NOT IN (
    'care_hospital','general_hospital','small_hospital','nursing_home',
    'home_health','pharmacy'
  ) THEN RAISE EXCEPTION '사업장 유형을 확인해 주세요'; END IF;
  IF length(trim(COALESCE(p_facility_name,''))) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION '사업장명을 2자 이상 입력해 주세요';
  END IF;
  IF length(trim(COALESCE(p_address_text,''))) NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION '사업장 주소를 입력해 주세요';
  END IF;
  IF length(trim(COALESCE(p_contact_name,''))) NOT BETWEEN 2 AND 50 THEN
    RAISE EXCEPTION '담당자명을 입력해 주세요';
  END IF;
  IF regexp_replace(COALESCE(p_contact_phone,''),'[^0-9]','','g') !~ '^0[0-9]{8,10}$' THEN
    RAISE EXCEPTION '연락처를 확인해 주세요';
  END IF;

  INSERT INTO public.facility_registration_requests (
    requested_by,facility_type,facility_name,address_text,
    contact_name,contact_phone,note
  ) VALUES (
    auth.uid(),p_facility_type,trim(p_facility_name),trim(p_address_text),
    trim(p_contact_name),trim(p_contact_phone),NULLIF(trim(COALESCE(p_note,'')),'')
  )
  ON CONFLICT (requested_by,facility_type,lower(facility_name))
    WHERE status IN ('pending','reviewing')
  DO UPDATE SET
    address_text=EXCLUDED.address_text,
    contact_name=EXCLUDED.contact_name,
    contact_phone=EXCLUDED.contact_phone,
    note=EXCLUDED.note,
    updated_at=now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_facility_registration_request(
  text,text,text,text,text,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_facility_registration_request(
  text,text,text,text,text,text
) TO authenticated;

