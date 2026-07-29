BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.service_plans
    WHERE code='pharmacy' AND monthly_fee=69000 AND is_active=true
  ) THEN RAISE EXCEPTION 'Pharmacy 69,000 plan is missing'; END IF;

  IF to_regprocedure('public.submit_facility_registration_request(text,text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Facility registration request RPC is missing';
  END IF;

  IF to_regclass('public.facility_registration_requests') IS NULL THEN
    RAISE EXCEPTION 'Facility registration request table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid='public.workers'::regclass
      AND tgname='trg_auto_approve_pharmacy_staff_profile'
      AND NOT tgisinternal
  ) THEN RAISE EXCEPTION 'Pharmacy staff approval trigger is missing'; END IF;

  IF position(
    'WHERE idempotency_key IS NOT NULL'
    IN pg_get_functiondef('public.finalize_credit_payment(text,text,text,jsonb)'::regprocedure)
  )=0 THEN RAISE EXCEPTION 'Legacy credit conflict predicate is not repaired'; END IF;
END $$;

ROLLBACK;
