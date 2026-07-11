-- Run against a disposable/staging database after all migrations.
-- Any failed assertion raises an exception and must block deployment.

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'shift_applications','shift_attendances','worker_bank_accounts',
      'payment_orders','credit_ledger','worker_credit_ledger',
      'credit_payout_requests','notification_outbox'
    )
    AND cmd = 'ALL';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P0: permissive FOR ALL policies remain on critical tables: %', v_count;
  END IF;
END;
$$;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon','authenticated')
    AND privilege_type IN ('INSERT','UPDATE','DELETE')
    AND table_name IN (
      'shift_applications','shift_attendances','worker_bank_accounts',
      'payment_orders','credit_ledger','worker_credit_ledger',
      'credit_payout_requests','attendance_audit','notification_outbox'
    );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P0: browser write grants remain on critical tables: %', v_count;
  END IF;
END;
$$;

DO $$
DECLARE
  v_public boolean;
BEGIN
  SELECT public INTO v_public FROM storage.buckets WHERE id = 'license-photos';
  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'P0: license-photos bucket must exist and be private';
  END IF;
END;
$$;

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND grantee IN ('PUBLIC','anon','authenticated')
    AND routine_name IN (
      'start_membership','close_membership_cycle','grant_membership_entitlements',
      'finalize_credit_payment','record_payment_reconciliation',
      'process_credit_payout','claim_notification_outbox','complete_notification_outbox'
    )
    AND privilege_type = 'EXECUTE';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P0: sensitive routines are callable by browser roles: %', v_count;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.apply_to_shift(uuid)') IS NULL
     OR to_regprocedure('public.consume_attendance_qr(text,uuid,double precision,double precision)') IS NULL
     OR to_regprocedure('public.finalize_credit_payment(text,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.complete_worker_onboarding(text,text,text,date,jsonb,text,text,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'P0: required RPC is missing';
  END IF;
END;
$$;

SELECT 'p0_schema_assertions_passed' AS result;
