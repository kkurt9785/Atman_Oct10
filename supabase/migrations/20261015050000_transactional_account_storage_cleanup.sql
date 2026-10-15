-- File deletion is an external operation: enqueue it in the withdrawal
-- transaction, then delete through the Storage API only after commit.
CREATE TABLE public.account_storage_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL CHECK (bucket_id='license-photos'),
  object_path text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  UNIQUE(bucket_id,object_path)
);
ALTER TABLE public.account_storage_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_storage_cleanup_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.account_storage_cleanup_jobs TO service_role;
CREATE INDEX account_storage_cleanup_pending ON public.account_storage_cleanup_jobs(next_attempt_at);

CREATE FUNCTION public.queue_withdrawal_storage_cleanup(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  INSERT INTO public.account_storage_cleanup_jobs(bucket_id,object_path)
  SELECT bucket_id,name FROM storage.objects
  WHERE bucket_id='license-photos' AND starts_with(name,p_user_id::text||'/')
  ON CONFLICT(bucket_id,object_path) DO NOTHING;
$$;
REVOKE ALL ON FUNCTION public.queue_withdrawal_storage_cleanup(uuid) FROM PUBLIC,anon,authenticated;

-- Preserve the current withdrawal guards/retention behavior, including changes
-- already deployed in prior migrations. Abort rather than patch a drifted body.
DO $patch$
DECLARE v_definition text;v_updated text;
BEGIN
  SELECT pg_get_functiondef('public.withdraw_my_account()'::regprocedure) INTO v_definition;
  IF position('queue_withdrawal_storage_cleanup' IN v_definition)=0 THEN
    v_updated := replace(v_definition,'DELETE FROM auth.users WHERE id = v_uid;',
      'PERFORM public.queue_withdrawal_storage_cleanup(v_uid); DELETE FROM auth.users WHERE id = v_uid;');
    IF v_updated=v_definition THEN RAISE EXCEPTION 'withdrawal body drifted; storage cleanup was not installed'; END IF;
    EXECUTE v_updated;
  END IF;
END
$patch$;

CREATE FUNCTION public.claim_account_storage_cleanup(p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,bucket_id text,object_path text)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  WITH pending AS (
    SELECT j.id FROM public.account_storage_cleanup_jobs j
    WHERE j.next_attempt_at<=now() AND (j.locked_until IS NULL OR j.locked_until<now())
    ORDER BY j.requested_at,j.id LIMIT greatest(1,least(coalesce(p_limit,20),100)) FOR UPDATE SKIP LOCKED
  )
  UPDATE public.account_storage_cleanup_jobs j SET attempts=j.attempts+1,locked_until=now()+interval '5 minutes'
  FROM pending WHERE j.id=pending.id RETURNING j.id,j.bucket_id,j.object_path;
$$;
REVOKE ALL ON FUNCTION public.claim_account_storage_cleanup(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_storage_cleanup(integer) TO service_role;

CREATE FUNCTION public.finish_account_storage_cleanup(p_id uuid,p_success boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_success IS NULL THEN RAISE EXCEPTION 'cleanup result is required'; END IF;
  IF p_success THEN
    DELETE FROM public.account_storage_cleanup_jobs WHERE id=p_id;
  ELSE
    UPDATE public.account_storage_cleanup_jobs SET locked_until=NULL,last_error='storage_remove_failed',
      next_attempt_at=now()+make_interval(secs=>least(21600,60*power(2,least(attempts,8)))::integer)
    WHERE id=p_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_account_storage_cleanup(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_account_storage_cleanup(uuid,boolean) TO service_role;

CREATE FUNCTION public.account_storage_cleanup_health()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'configured',EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='cron_secret' AND decrypted_secret IS NOT NULL),
    'pending',(SELECT count(*) FROM public.account_storage_cleanup_jobs),
    'overdue',(SELECT count(*) FROM public.account_storage_cleanup_jobs WHERE requested_at<now()-interval '15 minutes'),
    'scheduled',EXISTS(SELECT 1 FROM cron.job WHERE jobname='account-storage-cleanup-5min' AND active)
  );
$$;
REVOKE ALL ON FUNCTION public.account_storage_cleanup_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_storage_cleanup_health() TO service_role;

CREATE FUNCTION public.run_account_storage_cleanup()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_secret text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.account_storage_cleanup_jobs WHERE next_attempt_at<=now()
    AND (locked_until IS NULL OR locked_until<now())) THEN RETURN; END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='cron_secret' LIMIT 1;
  IF v_secret IS NOT NULL THEN
    PERFORM net.http_get(url:='https://admin.itdot.co.kr/api/cron/cleanup-account-storage',
      headers:=jsonb_build_object('Authorization','Bearer '||v_secret),timeout_milliseconds:=8000);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.run_account_storage_cleanup() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.run_account_storage_cleanup() TO service_role;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='account-storage-cleanup-5min';
SELECT cron.schedule('account-storage-cleanup-5min','*/5 * * * *','SELECT public.run_account_storage_cleanup();');
