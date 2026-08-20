-- Record how the facility verified a regulated worker before acceptance.
ALTER TABLE public.shift_applications
  ADD COLUMN IF NOT EXISTS credential_verification_method text;

ALTER TABLE public.shift_applications
  DROP CONSTRAINT IF EXISTS shift_applications_credential_verification_method_check;
ALTER TABLE public.shift_applications
  ADD CONSTRAINT shift_applications_credential_verification_method_check CHECK (
    credential_verification_method IS NULL OR credential_verification_method IN (
      'original_document', 'official_lookup', 'internal_hr_process'
    )
  );

CREATE OR REPLACE FUNCTION public.confirm_application_credential(
  p_application_id uuid,
  p_verification_method text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app public.shift_applications%ROWTYPE;
  v_facility_id uuid;
  v_role text;
BEGIN
  IF p_verification_method NOT IN ('original_document', 'official_lookup', 'internal_hr_process') THEN
    RAISE EXCEPTION '자격 확인 방법을 선택해 주세요';
  END IF;
  SELECT a.* INTO v_app FROM public.shift_applications a
  WHERE a.id = p_application_id FOR UPDATE OF a;
  IF NOT FOUND OR v_app.status <> 'applied' THEN
    RAISE EXCEPTION '확인할 수 없는 지원이에요';
  END IF;
  SELECT s.facility_id, w.role INTO v_facility_id, v_role
  FROM public.shifts s JOIN public.workers w ON w.id = v_app.worker_id
  WHERE s.id = v_app.shift_id;
  IF NOT public.can_manage_facility(v_facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION '자격을 확인할 권한이 없어요';
  END IF;
  IF v_role NOT IN ('rn', 'na', 'pharmacist') THEN
    RAISE EXCEPTION '사업장 직접 확인 대상이 아니에요';
  END IF;
  IF v_app.credential_review_status IN ('facility_confirmed', 'platform_verified') THEN
    RETURN true;
  END IF;
  UPDATE public.shift_applications
  SET credential_review_status = 'facility_confirmed',
      credential_verification_method = p_verification_method,
      credential_confirmed_by = auth.uid(),
      credential_confirmed_at = now()
  WHERE id = p_application_id;
  INSERT INTO public.audit_logs (actor_type, actor_id, action, entity_type, entity_id, after_data)
  VALUES ('admin', auth.uid(), 'shift_application.credential_confirm', 'shift_application', p_application_id,
    jsonb_build_object('role', v_role, 'method', p_verification_method));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_application_credential(p_application_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN public.confirm_application_credential(p_application_id, 'internal_hr_process');
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_application_credential(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_application_credential(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.confirm_application_credential(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_application_credential(uuid) TO authenticated;

SELECT
  to_regprocedure('public.confirm_application_credential(uuid,text)') IS NOT NULL AS method_rpc_ready,
  strpos(pg_get_functiondef('public.confirm_application_credential(uuid,text)'::regprocedure), 'p_verification_method') > 0 AS method_validated,
  strpos(pg_get_functiondef('public.confirm_application_credential(uuid,text)'::regprocedure), 'after_data') > 0 AS method_audited;
