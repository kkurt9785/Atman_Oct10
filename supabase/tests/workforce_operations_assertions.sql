-- Run after 20260715090000_workforce_operations.sql.
DO $$
BEGIN
  IF to_regclass('public.facility_worker_pool') IS NULL THEN
    RAISE EXCEPTION 'facility_worker_pool is missing';
  END IF;
  IF to_regclass('public.shift_templates') IS NULL THEN
    RAISE EXCEPTION 'shift_templates is missing';
  END IF;
  IF to_regprocedure('public.respond_to_shift_invitation(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'respond_to_shift_invitation is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shifts' AND column_name='audience'
  ) THEN
    RAISE EXCEPTION 'shifts.audience is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='trg_sync_facility_worker_pool' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'workforce pool sync trigger is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='trg_close_cancelled_invited_shift' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'invited shift cancellation trigger is missing';
  END IF;
END $$;
