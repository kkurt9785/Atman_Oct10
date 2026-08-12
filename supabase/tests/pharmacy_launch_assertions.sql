BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.service_plans
    WHERE code IN ('pharmacy','pharmacy_plus') AND job_posting_addon_price = 9000
    GROUP BY job_posting_addon_price HAVING count(*) = 2
  ) THEN RAISE EXCEPTION 'Pharmacy job posting add-on must be KRW 9,000 + VAT'; END IF;
  IF to_regclass('public.service_addon_credits') IS NULL THEN
    RAISE EXCEPTION 'Service add-on credits table is missing';
  END IF;
  IF to_regprocedure('public.grant_paid_service_addon()') IS NULL THEN
    RAISE EXCEPTION 'Paid service add-on grant function is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.service_plans
    WHERE code='pharmacy' AND monthly_fee=59000 AND included_attendance_slots=5 AND is_active=true
  ) THEN RAISE EXCEPTION 'Pharmacy 59,000 / 5 staff plan is missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.service_plans
    WHERE code='pharmacy_plus' AND monthly_fee=99000 AND included_attendance_slots=10 AND is_active=true
  ) THEN RAISE EXCEPTION 'Pharmacy Plus 99,000 / 10 staff plan is missing'; END IF;

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
