-- Store uploaded onboarding documents by their actual role and purpose.
ALTER TABLE public.worker_credentials
  DROP CONSTRAINT IF EXISTS worker_credentials_credential_type_check;
ALTER TABLE public.worker_credentials
  ADD CONSTRAINT worker_credentials_credential_type_check CHECK (credential_type IN (
    'nursing_license','na_certificate','pharmacist_license','resume','id_card',
    'health_check','cpr_cert','tuberculosis_test','vaccination','other'
  ));

CREATE OR REPLACE FUNCTION public.normalize_worker_credential_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
DECLARE v_role text;
BEGIN
  SELECT role INTO v_role FROM public.workers WHERE id=NEW.worker_id;
  IF v_role='pharmacist' THEN NEW.credential_type:='pharmacist_license';
  ELSIF v_role='pharmacy_staff' THEN NEW.credential_type:='resume';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_worker_credential_type ON public.worker_credentials;
CREATE TRIGGER trg_normalize_worker_credential_type
BEFORE INSERT OR UPDATE OF worker_id,credential_type ON public.worker_credentials
FOR EACH ROW EXECUTE FUNCTION public.normalize_worker_credential_type();

UPDATE public.worker_credentials credential
SET credential_type=CASE worker.role
  WHEN 'pharmacist' THEN 'pharmacist_license'
  WHEN 'pharmacy_staff' THEN 'resume'
  ELSE credential.credential_type END,
  updated_at=now()
FROM public.workers worker
WHERE worker.id=credential.worker_id
  AND worker.role IN ('pharmacist','pharmacy_staff')
  AND credential.credential_type IS DISTINCT FROM CASE worker.role
    WHEN 'pharmacist' THEN 'pharmacist_license' ELSE 'resume' END;
