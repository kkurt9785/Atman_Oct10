-- Local pg_cron regression only. All job changes roll back at the end.
BEGIN;
CREATE TEMP TABLE demo_legacy_jobs(name text PRIMARY KEY);
INSERT INTO demo_legacy_jobs VALUES
  ('demo_showcase_refresh_0005kst'),('demo_clinic_workforce_refresh_0010kst'),
  ('demo-pharmacy-workforce-daily'),('anchor-demo-showcase-daily'),
  ('w_womens_showcase_every_3_hours'),('demo1-wf-application-daily'),
  ('demo1-chat-showcase-daily'),('demo_worker_locations_00kst'),
  ('demo_worker_locations_08kst'),('demo_worker_locations_16kst');
SELECT cron.schedule(name,'0 0 * * *','SELECT 1;') FROM demo_legacy_jobs;
SELECT cron.schedule('demo-worker-readiness-15min','*/15 * * * *','SELECT 2;');
SELECT cron.schedule('qa-unrelated-production-job','0 0 * * *','SELECT 3;');
CREATE TEMP TABLE original_demo_jobs AS SELECT jobid,jobname,schedule,command FROM cron.job;
-- APPLY_MIGRATION
-- APPLY_MIGRATION
DO $$ BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname IN (SELECT name FROM demo_legacy_jobs) AND NOT active)<>10 THEN
    RAISE EXCEPTION 'all legacy reset/rotation jobs must be inactive';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='demo-worker-readiness-15min' AND active AND schedule='*/15 * * * *') THEN
    RAISE EXCEPTION '15-minute preparation was disabled';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='qa-unrelated-production-job' AND active) THEN
    RAISE EXCEPTION 'unrelated production job was changed';
  END IF;
  IF EXISTS(SELECT 1 FROM original_demo_jobs o LEFT JOIN cron.job j ON j.jobid=o.jobid
    WHERE j.jobid IS NULL OR (j.jobname,j.schedule,j.command) IS DISTINCT FROM (o.jobname,o.schedule,o.command)) THEN
    RAISE EXCEPTION 'job definitions were removed or rewritten';
  END IF;
END $$;
SELECT 'PASS: 10 legacy jobs disabled, readiness/unrelated jobs preserved, definitions retained, repeat application safe' AS result;
ROLLBACK;
