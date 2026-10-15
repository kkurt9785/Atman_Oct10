BEGIN;
CREATE SCHEMA qa_account_storage;
GRANT USAGE ON SCHEMA qa_account_storage TO authenticated,service_role;
CREATE TABLE public.users(id uuid PRIMARY KEY,allowed boolean NOT NULL DEFAULT true,fail_delete boolean NOT NULL DEFAULT false);
CREATE TABLE storage.objects(bucket_id text,name text);
CREATE FUNCTION public.withdraw_my_account() RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid();
BEGIN
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_uid AND allowed) THEN RAISE EXCEPTION 'withdrawal refused'; END IF;
  DELETE FROM auth.users WHERE id = v_uid;
  RETURN true;
END $$;
-- APPLY_MIGRATION
CREATE FUNCTION pg_temp.check_that(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label; END IF;RAISE NOTICE 'PASS: %',label;
END $$;
CREATE FUNCTION pg_temp.reject(query text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE query;EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN;END IF;RAISE;END;
  RAISE EXCEPTION 'Unexpected success: %',query;
END $$;
INSERT INTO auth.users(id,allowed,fail_delete) VALUES
 ('10000000-0000-4000-8000-000000000001',false,false),('10000000-0000-4000-8000-000000000002',true,true),
 ('10000000-0000-4000-8000-000000000003',true,false);
INSERT INTO storage.objects VALUES
 ('license-photos','10000000-0000-4000-8000-000000000001/license.jpg'),
 ('license-photos','10000000-0000-4000-8000-000000000002/license.jpg'),
 ('license-photos','10000000-0000-4000-8000-000000000003/license.jpg'),
 ('license-photos','10000000-0000-4000-8000-000000000003/second.jpg'),
 ('another-bucket','10000000-0000-4000-8000-000000000003/untouched.jpg');
CREATE FUNCTION pg_temp.fail_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.fail_delete THEN RAISE EXCEPTION 'forced auth failure'; END IF;RETURN OLD;
END $$;
CREATE TRIGGER fail_auth_delete BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_deletion();
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT pg_temp.reject('SELECT public.withdraw_my_account()','withdrawal refused');
SELECT pg_temp.check_that((SELECT count(*)=0 FROM public.account_storage_cleanup_jobs),'refused withdrawal queues no deletion');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
SELECT pg_temp.reject('SELECT public.withdraw_my_account()','forced auth failure');
SELECT pg_temp.check_that((SELECT count(*)=0 FROM public.account_storage_cleanup_jobs),'auth deletion failure rolls back the cleanup queue');
SELECT pg_temp.check_that((SELECT count(*)=3 FROM auth.users),'failed withdrawals preserve accounts');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
SELECT public.withdraw_my_account();
SELECT pg_temp.check_that((SELECT count(*)=2 FROM public.account_storage_cleanup_jobs),'successful withdrawal queues all and only its license files');
SELECT pg_temp.check_that((SELECT count(*)=5 FROM storage.objects),'database never deletes storage metadata/files directly');
CREATE TEMP TABLE claimed AS SELECT * FROM public.claim_account_storage_cleanup(1);
SELECT pg_temp.check_that((SELECT count(*)=1 FROM claimed),'one worker claims a bounded batch');
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.claim_account_storage_cleanup(20)),'another worker cannot reclaim leased work');
SELECT public.finish_account_storage_cleanup((SELECT id FROM claimed),false);
SELECT pg_temp.check_that((SELECT count(*)=0 FROM public.claim_account_storage_cleanup(20)),'failed removal waits for backoff');
SELECT pg_temp.check_that((SELECT attempts=1 AND last_error='storage_remove_failed' AND next_attempt_at>now() FROM public.account_storage_cleanup_jobs WHERE id=(SELECT id FROM claimed)),'retry remains durable after external failure');
SELECT public.finish_account_storage_cleanup((SELECT id FROM claimed),true);
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.account_storage_cleanup_jobs),'successful cleanup removes its queued path');
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject('SELECT * FROM public.account_storage_cleanup_jobs','permission denied');
SELECT pg_temp.reject('SELECT * FROM public.claim_account_storage_cleanup(20)','permission denied');
RESET ROLE;
SELECT 'PASS: transactional account storage cleanup' AS result;
ROLLBACK;
