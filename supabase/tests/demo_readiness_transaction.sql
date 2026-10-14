-- Inject 20261014200000 at APPLY_MIGRATION and replace public. with
-- qa_demo_readiness. in the combined input. Local transaction, full rollback.
BEGIN;
CREATE SCHEMA qa_demo_readiness;
GRANT USAGE ON SCHEMA qa_demo_readiness TO authenticated;
CREATE FUNCTION pg_temp.uid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(('readiness-test-'||n)::text)::uuid $$;
CREATE TABLE public.workers(id uuid PRIMARY KEY,auth_user_id uuid,is_demo boolean,deleted_at timestamptz,verification_status text,last_active_at timestamptz);
CREATE TABLE public.facilities(id uuid PRIMARY KEY,is_demo boolean,is_active boolean,deleted_at timestamptz,business_registration_number text);
CREATE TABLE public.shifts(id uuid PRIMARY KEY,facility_id uuid,shift_date date,start_time time,end_time time,hourly_wage integer,estimated_total_pay integer,updated_at timestamptz,notes text,status text,matched_worker_id uuid);
CREATE TABLE public.shift_attendances(shift_id uuid);
CREATE TABLE public.shift_applications(shift_id uuid,worker_id uuid);
CREATE TABLE public.facility_staff(id uuid PRIMARY KEY,facility_id uuid,worker_id uuid,default_start_time time,default_end_time time,work_weekdays integer[],updated_at timestamptz);
CREATE TABLE public.staff_attendances(staff_id uuid,work_date date,check_in_at timestamptz,check_out_at timestamptz);
CREATE TABLE public.reset_calls(called_at timestamptz);
CREATE FUNCTION public.reset_gigworker_invite_demo() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN INSERT INTO public.reset_calls VALUES(now()); RETURN '20260922-0000-4000-8000-000000000006'::uuid; END $$;
CREATE FUNCTION public.is_demo_account(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.workers WHERE auth_user_id=p_uid AND is_demo); $$;
INSERT INTO auth.users(id,email) VALUES(pg_temp.uid(1),'readiness-real@example.invalid'),(pg_temp.uid(2),'worker-gig-demo@demo.atman.co.kr'),(pg_temp.uid(4),'readiness-banned@example.invalid');
UPDATE auth.users SET banned_until='infinity' WHERE id=pg_temp.uid(4);
INSERT INTO public.workers VALUES(pg_temp.uid(1),pg_temp.uid(1),false,NULL,'approved',NULL),(pg_temp.uid(2),pg_temp.uid(2),true,NULL,'approved',NULL),(pg_temp.uid(3),NULL,true,now(),'approved',NULL),(pg_temp.uid(4),pg_temp.uid(4),true,NULL,'approved',NULL);
INSERT INTO public.facilities VALUES(pg_temp.uid(100),true,true,NULL,'DEMO-TARGET-0001'),(pg_temp.uid(101),false,true,NULL,'REAL'),(pg_temp.uid(102),true,true,NULL,'DEMO-GIGWORKER-2026');
INSERT INTO public.shifts
SELECT pg_temp.uid(n),CASE WHEN n=12 THEN pg_temp.uid(101) ELSE pg_temp.uid(100) END,
  (now() AT TIME ZONE 'Asia/Seoul')::date-1,'09:00','10:00',15000,15000,NULL,'LIVE-SALES-DEMO-TEST',
  CASE WHEN n IN (11,14) THEN 'matched' WHEN n=15 THEN 'completed' ELSE 'open' END,
  CASE WHEN n IN (11,14) THEN pg_temp.uid(2) END
FROM generate_series(10,15)n;
INSERT INTO public.shift_attendances VALUES(pg_temp.uid(11));
INSERT INTO public.shift_applications VALUES(pg_temp.uid(13),pg_temp.uid(1));
INSERT INTO public.facility_staff VALUES('20260922-0000-4000-8000-000000000004',pg_temp.uid(102),pg_temp.uid(2),'09:00','18:00',ARRAY[1],now()-interval '4 hours');
-- APPLY_MIGRATION

SELECT public.refresh_demo_worker_readiness();
DO $$ BEGIN
  IF (SELECT count(*) FROM public.workers WHERE last_active_at IS NOT NULL)<>1 THEN RAISE EXCEPTION 'real/deleted/banned worker refreshed'; END IF;
  IF (SELECT count(*) FROM public.shifts WHERE updated_at IS NOT NULL)<>2 THEN RAISE EXCEPTION 'active/real/mixed/completed shift changed'; END IF;
  IF EXISTS(SELECT 1 FROM public.shifts WHERE updated_at IS NOT NULL AND estimated_total_pay<>11250) THEN RAISE EXCEPTION 'window wage mismatch'; END IF;
END $$;
-- Real user cannot invoke demo preparation.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
DO $$ BEGIN
  BEGIN PERFORM public.prepare_my_demo_worker(); RAISE EXCEPTION 'real user refreshed demos';
  EXCEPTION WHEN raise_exception THEN IF position('시연 계정만' IN SQLERRM)=0 THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub',pg_temp.uid(2)::text,true);
SELECT public.prepare_my_demo_worker();
SELECT public.reset_gigworker_invite_demo(); -- recent session: resume
RESET ROLE;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.reset_calls) THEN RAISE EXCEPTION 'recent session was reset'; END IF; END $$;
UPDATE public.facility_staff SET updated_at=now()-interval '4 hours',default_start_time='01:23';
INSERT INTO public.staff_attendances VALUES('20260922-0000-4000-8000-000000000004',(now() AT TIME ZONE 'Asia/Seoul')::date,now()-interval '3 hours',NULL);
SELECT public.refresh_demo_worker_readiness();
SELECT public.reset_gigworker_invite_demo();
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.reset_calls) THEN RAISE EXCEPTION 'ongoing shift reset'; END IF;
  IF (SELECT default_start_time FROM public.facility_staff)<>'01:23'::time THEN RAISE EXCEPTION 'ongoing schedule changed'; END IF;
END $$;
UPDATE public.staff_attendances SET check_out_at=now()-interval '20 minutes';
SELECT public.reset_gigworker_invite_demo();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.reset_calls) THEN RAISE EXCEPTION 'recently completed session reset'; END IF; END $$;
UPDATE public.staff_attendances SET check_out_at=now()-interval '2 hours';
SELECT public.reset_gigworker_invite_demo();
DO $$ BEGIN IF (SELECT count(*) FROM public.reset_calls)<>1 THEN RAISE EXCEPTION 'idle completed session not reset'; END IF; END $$;
SELECT 'PASS: 15-minute readiness, demo-only scope, real/deleted/banned exclusions, active shift preservation, resume and idle reset' AS result;
ROLLBACK;
