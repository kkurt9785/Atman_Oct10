-- MANUAL RELEASE STEP — never add this file to automatic migrations.
-- Run only after setting both transaction-local guards:
--   BEGIN;
--   SET LOCAL app.environment = 'production';
--   SET LOCAL app.confirm_demo_cleanup = 'YES';
--   \i scripts/prepare-production.sql
--   COMMIT;

DO $$
BEGIN
  IF current_setting('app.environment', true) IS DISTINCT FROM 'production'
     OR current_setting('app.confirm_demo_cleanup', true) IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'Production cleanup guard not satisfied';
  END IF;
END;
$$;

-- Stop demo jobs. Missing pg_cron/jobs are tolerated.
DO $$
DECLARE
  v_job record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  FOR v_job IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'demo_worker_locations_00kst',
      'demo_worker_locations_08kst',
      'demo_worker_locations_16kst',
      'demo_showcase_refresh_0005kst'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END;
$$;

-- Make demo identities unusable without destructive deletion. Keep rows for
-- forensic review until the release owner approves permanent removal.
UPDATE auth.users
SET banned_until = 'infinity'::timestamptz,
    encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')),
    updated_at = now()
WHERE email LIKE '%@demo.atman.co.kr';

UPDATE public.workers
SET deleted_at = COALESCE(deleted_at, now()), updated_at = now()
WHERE is_demo = true;

UPDATE public.facilities
SET is_active = false, deleted_at = COALESCE(deleted_at, now()), updated_at = now()
WHERE is_demo = true;

DO $$
BEGIN
  IF to_regprocedure('public.refresh_demo_showcase_day()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.refresh_demo_showcase_day() FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.rotate_demo_worker_locations(integer)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rotate_demo_worker_locations(integer) FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;

-- The UI also requires NEXT_PUBLIC_ENABLE_DEMO_LOGIN=0 in every production
-- deployment. Verify that separately in the deployment dashboard.
