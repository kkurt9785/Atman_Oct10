BEGIN;
CREATE SCHEMA qa_staff_leave;
GRANT USAGE ON SCHEMA qa_staff_leave TO authenticated;
CREATE TABLE public.facility_staff(id uuid PRIMARY KEY,facility_id uuid,status text,work_weekdays smallint[]);
CREATE TABLE public.staff_leave_balances(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),facility_id uuid,staff_id uuid,leave_year integer,granted_minutes integer,used_minutes integer,updated_at timestamptz,UNIQUE(staff_id,leave_year));
CREATE TABLE public.staff_leave_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),facility_id uuid,staff_id uuid,leave_type text,start_date date,end_date date,requested_minutes integer,reason text,status text,decided_by uuid,decided_at timestamptz);
CREATE TABLE public.staff_attendances(staff_id uuid,work_date date,check_in_at timestamptz,check_out_at timestamptz);
CREATE FUNCTION public.can_manage_facility(uuid,text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='10000000-0000-4000-8000-000000000001'::uuid $$;
CREATE FUNCTION public.calculate_staff_leave_minutes(uuid,text,date,date,integer) RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  IF $3 IS NULL OR $4 IS NULL OR extract(year from $3)<>extract(year from $4) THEN RAISE EXCEPTION '같은 연도'; END IF;
  IF $2 NOT IN ('annual','half_day','quarter_day','hourly','sick','other') THEN RAISE EXCEPTION '휴가 유형'; END IF;
  IF $2='hourly' THEN RETURN $5; END IF;
  IF $2='half_day' THEN RETURN 240; END IF;
  RETURN 480;
END $$;
-- APPLY_MIGRATION
CREATE FUNCTION pg_temp.reject(query text,expected text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE query; EXCEPTION WHEN OTHERS THEN IF position(expected IN SQLERRM)>0 THEN RETURN; END IF;RAISE;END;
  RAISE EXCEPTION 'Unexpected success: %',query;
END $$;
CREATE FUNCTION pg_temp.check_that(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %',label;END IF;RAISE NOTICE 'PASS: %',label;
END $$;
INSERT INTO public.facility_staff VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','active',ARRAY[1,2,3,4,5]::smallint[]);
INSERT INTO public.staff_leave_balances(facility_id,staff_id,leave_year,granted_minutes,used_minutes) VALUES('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',extract(year from current_date)::integer,480,0);
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000099',true);
SELECT pg_temp.reject(format('SELECT public.create_approved_staff_leave(%L,%L,%L,%L,%L)', '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','annual',current_date+1,current_date+1),'권한');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
CREATE FUNCTION pg_temp.fail_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa forced request failure'; END $$;
CREATE TRIGGER qa_fail_request BEFORE INSERT ON public.staff_leave_requests FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_request();
SELECT pg_temp.reject(format('SELECT public.create_approved_staff_leave(%L,%L,%L,%L,%L)', '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','annual',current_date+1,current_date+1),'qa forced');
SELECT pg_temp.check_that((SELECT used_minutes=0 FROM public.staff_leave_balances),'request failure rolls back balance use');
DROP TRIGGER qa_fail_request ON public.staff_leave_requests;
SELECT public.create_approved_staff_leave('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','annual',current_date+1,current_date+1);
SELECT pg_temp.check_that((SELECT used_minutes=480 FROM public.staff_leave_balances),'approved leave deducts once');
SELECT pg_temp.reject(format('SELECT public.create_approved_staff_leave(%L,%L,%L,%L,%L)', '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','annual',current_date+1,current_date+1),'같은 기간');
SELECT pg_temp.reject(format('SELECT public.create_approved_staff_leave(%L,%L,%L,%L,%L)', '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','annual',current_date+2,current_date+2),'잔여 휴가');
SELECT pg_temp.reject($q$SELECT public.set_staff_leave_grant('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',extract(year from current_date)::integer,0)$q$,'이미 사용한');
SELECT public.set_staff_leave_grant('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',extract(year from current_date)::integer,2);
SELECT pg_temp.check_that((SELECT granted_minutes=960 AND used_minutes=480 FROM public.staff_leave_balances),'grant edit preserves used leave');
INSERT INTO public.staff_attendances VALUES('30000000-0000-4000-8000-000000000001',current_date+3,now(),NULL);
SELECT pg_temp.reject(format('SELECT public.create_approved_staff_leave(%L,%L,%L,%L,%L)', '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','annual',current_date+3,current_date+3),'출퇴근 기록');
SELECT pg_temp.check_that((SELECT count(*)=1 FROM public.staff_leave_requests),'rejected request leaves no partial row');
SELECT 'PASS: atomic administrator leave and balance management' AS result;
ROLLBACK;
