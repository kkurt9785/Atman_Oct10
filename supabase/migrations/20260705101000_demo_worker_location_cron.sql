-- Rotate demo worker locations three times per day.
-- pg_cron schedules are UTC:
--   23:00 UTC = 08:00 KST -> slot 0
--   07:00 UTC = 16:00 KST -> slot 1
--   15:00 UTC = 00:00 KST -> slot 2

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN (
  'demo_worker_locations_00kst',
  'demo_worker_locations_08kst',
  'demo_worker_locations_16kst'
);

SELECT cron.schedule(
  'demo_worker_locations_08kst',
  '0 23 * * *',
  'select public.rotate_demo_worker_locations(0);'
);

SELECT cron.schedule(
  'demo_worker_locations_16kst',
  '0 7 * * *',
  'select public.rotate_demo_worker_locations(1);'
);

SELECT cron.schedule(
  'demo_worker_locations_00kst',
  '0 15 * * *',
  'select public.rotate_demo_worker_locations(2);'
);
