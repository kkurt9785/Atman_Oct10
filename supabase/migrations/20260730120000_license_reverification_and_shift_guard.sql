-- Changing a licensed worker's number must always require re-review.
-- Non-licensed roles cannot use this RPC.
CREATE OR REPLACE FUNCTION public.set_my_license_number(p_number text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker_id uuid := public.current_worker_id();
  v_number text := NULLIF(trim(COALESCE(p_number, '')), '');
  v_role text;
BEGIN
  IF v_worker_id IS NULL THEN RAISE EXCEPTION '워커 정보를 찾을 수 없어요'; END IF;

  SELECT role INTO v_role
  FROM public.workers
  WHERE id=v_worker_id AND deleted_at IS NULL;

  IF v_role NOT IN ('rn','na','pharmacist') THEN
    RAISE EXCEPTION '면허가 필요한 직군만 면허 번호를 등록할 수 있어요';
  END IF;
  IF v_number IS NULL OR length(v_number) NOT BETWEEN 4 AND 100
     OR v_number ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION '면허 번호를 확인해 주세요';
  END IF;

  UPDATE public.workers
  SET license_number=v_number,
      verification_status=CASE
        WHEN license_number IS DISTINCT FROM v_number THEN 'reviewing'
        ELSE verification_status
      END,
      verified_at=CASE
        WHEN license_number IS DISTINCT FROM v_number THEN NULL
        ELSE verified_at
      END,
      rejection_reason=NULL,
      updated_at=now()
  WHERE id=v_worker_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_license_number(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_license_number(text) TO authenticated;

DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_functiondef('public.set_my_license_number(text)'::regprocedure) INTO def;
  IF position('v_role NOT IN' IN def)=0
     OR position('verified_at' IN def)=0 THEN
    RAISE EXCEPTION 'license re-verification guard is missing';
  END IF;
END $$;
