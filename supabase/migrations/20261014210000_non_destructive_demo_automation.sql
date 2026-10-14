-- Keep legacy job definitions for rollback/manual maintenance, but never
-- delete/reseed demo staff, attendance, chats or locations on a timer.
-- Automatic preparation is owned by refresh_demo_worker_readiness (15 min).
DO $$
DECLARE v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid FROM cron.job WHERE jobname IN (
      'demo_showcase_refresh_0005kst',
      'demo_clinic_workforce_refresh_0010kst',
      'demo-pharmacy-workforce-daily',
      'anchor-demo-showcase-daily',
      'w_womens_showcase_every_3_hours',
      'demo1-wf-application-daily',
      'demo1-chat-showcase-daily',
      'demo_worker_locations_00kst',
      'demo_worker_locations_08kst',
      'demo_worker_locations_16kst'
    )
  LOOP
    PERFORM cron.alter_job(v_job.jobid, active := false);
  END LOOP;
END;
$$;
