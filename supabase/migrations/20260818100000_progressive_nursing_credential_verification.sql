-- Progressive credential verification for nurses and nursing assistants.
-- They may browse and apply without uploading a document, but a facility must
-- explicitly confirm the original credential before accepting the application.

ALTER TABLE public.shift_applications
  ADD COLUMN IF NOT EXISTS credential_review_status text,
  ADD COLUMN IF NOT EXISTS credential_confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credential_confirmed_at timestamptz;

UPDATE public.shift_applications a
SET credential_review_status = CASE
  WHEN w.verification_status = 'approved' THEN 'platform_verified'
  WHEN w.role IN ('rn', 'na') THEN 'pending_facility_check'
  ELSE 'not_required'
END
FROM public.workers w
WHERE w.id = a.worker_id
  AND a.credential_review_status IS NULL;

ALTER TABLE public.shift_applications
  ALTER COLUMN credential_review_status SET DEFAULT 'not_required',
  ALTER COLUMN credential_review_status SET NOT NULL;

ALTER TABLE public.shift_applications
  DROP CONSTRAINT IF EXISTS shift_applications_credential_review_status_check;
ALTER TABLE public.shift_applications
  ADD CONSTRAINT shift_applications_credential_review_status_check CHECK (
    credential_review_status IN ('not_required', 'pending_facility_check', 'facility_confirmed', 'platform_verified')
  );

CREATE OR REPLACE FUNCTION public.set_application_credential_review_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_worker public.workers%ROWTYPE;
BEGIN
  IF NEW.status <> 'applied' OR (TG_OP = 'UPDATE' AND OLD.status = 'applied') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = NEW.worker_id;
  NEW.credential_review_status := CASE
    WHEN v_worker.verification_status = 'approved' THEN 'platform_verified'
    WHEN v_worker.role IN ('rn', 'na') THEN 'pending_facility_check'
    ELSE 'not_required'
  END;
  NEW.credential_confirmed_by := NULL;
  NEW.credential_confirmed_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_credential_review_status ON public.shift_applications;
CREATE TRIGGER trg_application_credential_review_status
BEFORE INSERT OR UPDATE OF status ON public.shift_applications
FOR EACH ROW EXECUTE FUNCTION public.set_application_credential_review_status();

CREATE OR REPLACE FUNCTION public.confirm_application_credential(p_application_id uuid)
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
  SELECT a.* INTO v_app
  FROM public.shift_applications a
  WHERE a.id = p_application_id
  FOR UPDATE OF a;

  IF NOT FOUND OR v_app.status <> 'applied' THEN
    RAISE EXCEPTION '확인할 수 없는 지원이에요';
  END IF;
  SELECT s.facility_id, w.role INTO v_facility_id, v_role
  FROM public.shifts s
  JOIN public.workers w ON w.id = v_app.worker_id
  WHERE s.id = v_app.shift_id;
  IF NOT public.can_manage_facility(v_facility_id, ARRAY['owner','operator','super']::text[]) THEN
    RAISE EXCEPTION '자격을 확인할 권한이 없어요';
  END IF;
  IF v_role NOT IN ('rn', 'na') THEN
    RAISE EXCEPTION '사업장 직접 확인 대상이 아니에요';
  END IF;

  UPDATE public.shift_applications
  SET credential_review_status = 'facility_confirmed',
      credential_confirmed_by = auth.uid(),
      credential_confirmed_at = now()
  WHERE id = p_application_id;

  INSERT INTO public.audit_logs (
    actor_type, actor_id, action, entity_type, entity_id, after_data
  ) VALUES (
    'admin', auth.uid(), 'shift_application.credential_confirm', 'shift_application', p_application_id,
    jsonb_build_object('role', v_role, 'method', 'original_checked_by_facility')
  );
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_application_credential(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_application_credential(uuid) TO authenticated;

-- Keep all later demo-isolation and audience patches by editing the deployed
-- function definitions instead of replacing them with an older snapshot.
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.get_nearby_open_shifts_secure(double precision,double precision,text[])');
  def text;
  patched text;
BEGIN
  SELECT pg_get_functiondef(fn) INTO def;
  patched := replace(
    def,
    'AND w.verification_status = ''approved''',
    'AND (w.role IN (''rn'', ''na'') OR w.verification_status = ''approved'')'
  );
  IF patched = def AND def NOT LIKE '%w.role IN (''rn'', ''na'') OR w.verification_status = ''approved''%' THEN
    RAISE EXCEPTION 'shift discovery credential guard patch failed';
  END IF;
  EXECUTE patched;
END $$;

-- Nurses can complete experience fields without uploading a credential.
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.update_my_worker_profile(text,text,text,text,text[])');
  def text;
  patched text;
BEGIN
  SELECT pg_get_functiondef(fn) INTO def;
  patched := replace(
    def,
    'COALESCE(v_worker_role, '''') <> ''pharmacy_staff'' AND NULLIF(trim(COALESCE(p_license_number, '''')), '''') IS NULL AND p_license_path IS NULL',
    'COALESCE(v_worker_role, '''') NOT IN (''pharmacy_staff'', ''rn'', ''na'') AND NULLIF(trim(COALESCE(p_license_number, '''')), '''') IS NULL AND p_license_path IS NULL'
  );
  IF patched = def AND def NOT LIKE '%NOT IN (''pharmacy_staff'', ''rn'', ''na'')%' THEN
    RAISE EXCEPTION 'worker profile credential guard patch failed';
  END IF;
  EXECUTE patched;
END $$;

-- A nurse who opted to verify later should still receive matching public shift
-- alerts. Pharmacists remain platform-verified before discovery and alerts.
DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.get_shift_notification_recipients(uuid)');
  def text;
  patched text;
BEGIN
  SELECT pg_get_functiondef(fn) INTO def;
  patched := replace(
    def,
    'AND w.verification_status = ''approved''',
    'AND (w.role IN (''rn'', ''na'') OR w.verification_status = ''approved'')'
  );
  IF patched = def AND def NOT LIKE '%w.role IN (''rn'', ''na'') OR w.verification_status = ''approved''%' THEN
    RAISE EXCEPTION 'shift notification credential guard patch failed';
  END IF;
  EXECUTE patched;
END $$;

DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.apply_to_shift(uuid)');
  def text;
  patched text;
BEGIN
  SELECT pg_get_functiondef(fn) INTO def;
  patched := replace(
    def,
    'IF NOT FOUND OR v_worker.verification_status <> ''approved'' THEN
    RAISE EXCEPTION ''심사 승인 후 지원할 수 있어요'';
  END IF;',
    'IF NOT FOUND OR (v_worker.role NOT IN (''rn'', ''na'') AND v_worker.verification_status <> ''approved'') THEN
    RAISE EXCEPTION ''이 직군은 자격 심사 승인 후 지원할 수 있어요'';
  END IF;'
  );
  IF patched = def AND def NOT LIKE '%v_worker.role NOT IN (''rn'', ''na'')%' THEN
    RAISE EXCEPTION 'apply credential guard patch failed';
  END IF;
  EXECUTE patched;
END $$;

DO $$
DECLARE
  fn regprocedure := to_regprocedure('public.accept_shift_application(uuid)');
  def text;
  patched text;
BEGIN
  SELECT pg_get_functiondef(fn) INTO def;
  patched := replace(
    def,
    'IF NOT FOUND OR v_worker.verification_status <> ''approved'' THEN
    RAISE EXCEPTION ''승인된 워커만 수락할 수 있어요'';
  END IF;',
    'IF NOT FOUND OR (
    v_worker.verification_status <> ''approved''
    AND NOT (v_worker.role IN (''rn'', ''na'') AND v_app.credential_review_status = ''facility_confirmed'')
  ) THEN
    RAISE EXCEPTION ''면허·자격 원본 확인 후 채용을 확정해 주세요'';
  END IF;'
  );
  IF patched = def AND def NOT LIKE '%credential_review_status = ''facility_confirmed''%' THEN
    RAISE EXCEPTION 'accept credential guard patch failed';
  END IF;
  EXECUTE patched;
END $$;

SELECT
  strpos(pg_get_functiondef('public.get_nearby_open_shifts_secure(double precision,double precision,text[])'::regprocedure), 'w.role IN (''rn'', ''na'')') > 0 AS discovery_progressive,
  strpos(pg_get_functiondef('public.apply_to_shift(uuid)'::regprocedure), 'v_worker.role NOT IN (''rn'', ''na'')') > 0 AS application_progressive,
  strpos(pg_get_functiondef('public.accept_shift_application(uuid)'::regprocedure), 'credential_review_status = ''facility_confirmed''') > 0 AS acceptance_guarded,
  to_regprocedure('public.confirm_application_credential(uuid)') IS NOT NULL AS confirmation_ready,
  strpos(pg_get_functiondef('public.get_shift_notification_recipients(uuid)'::regprocedure), 'w.role IN (''rn'', ''na'')') > 0 AS notifications_progressive;
