-- Isolated local schema fixture. Inject 20261014190000 at APPLY_MIGRATION,
-- then replace public. with qa_payroll_access. in the combined input.
-- Uses real authenticated role + auth.uid() + RLS; all changes roll back.
BEGIN;
CREATE SCHEMA qa_payroll_access;
GRANT USAGE ON SCHEMA qa_payroll_access TO authenticated;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION pg_temp.uid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(('access-test-'||n)::text)::uuid $$;
CREATE TABLE public.facilities(id uuid PRIMARY KEY,admin_user_id uuid,is_active boolean,deleted_at timestamptz,is_demo boolean);
CREATE TABLE public.facility_admin_access(facility_id uuid,user_id uuid,access_role text,can_view_payroll boolean);
CREATE TABLE public.workers(id uuid PRIMARY KEY,auth_user_id uuid,is_demo boolean);
CREATE TABLE public.facility_staff(id uuid PRIMARY KEY,facility_id uuid,worker_id uuid);
CREATE TABLE public.gig_payouts(id uuid,facility_id uuid,staff_id uuid);
CREATE TABLE public.staff_wage_payments(id uuid,facility_id uuid);
CREATE TABLE public.wage_payment_instructions(id uuid,facility_id uuid,worker_id uuid);
CREATE TABLE public.gig_bank_account_shares(staff_id uuid,facility_id uuid,worker_id uuid,bank_account_id uuid,shared_at timestamptz);
CREATE TABLE public.worker_bank_accounts(id uuid,worker_id uuid,bank_name text,account_number_encrypted bytea,account_number_last4 text,account_holder_name text,is_primary boolean,deleted_at timestamptz);
CREATE FUNCTION public.is_demo_account(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id=p_uid AND lower(email) LIKE '%@demo.atman.co.kr') OR EXISTS(SELECT 1 FROM public.workers WHERE auth_user_id=p_uid AND is_demo);
$$;
CREATE FUNCTION public.can_manage_facility(p_facility_id uuid,p_roles text[]) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN coalesce(public.facility_access_role(p_facility_id)=ANY(p_roles),false); END $$;
CREATE FUNCTION public.bank_encryption_key() RETURNS text LANGUAGE sql AS $$ SELECT 'fixture-only-key'::text $$;
ALTER TABLE public.gig_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_wage_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wage_payment_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gig_bank_account_shares ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gig_payouts,public.staff_wage_payments,public.wage_payment_instructions,public.gig_bank_account_shares TO authenticated;
CREATE POLICY gig_payouts_worker_read ON public.gig_payouts FOR SELECT TO authenticated USING (staff_id=pg_temp.uid(200) AND auth.uid()=pg_temp.uid(6));
INSERT INTO auth.users(id,email) SELECT pg_temp.uid(n),CASE WHEN n=5 THEN 'access-fixture@demo.atman.co.kr' ELSE 'access-fixture-'||n||'@example.invalid' END FROM generate_series(1,6)n;
INSERT INTO public.facilities VALUES (pg_temp.uid(100),pg_temp.uid(1),true,NULL,false),(pg_temp.uid(101),pg_temp.uid(5),true,NULL,true),(pg_temp.uid(102),pg_temp.uid(1),false,NULL,false);
INSERT INTO public.facility_admin_access VALUES (pg_temp.uid(100),pg_temp.uid(2),'operator',false),(pg_temp.uid(100),pg_temp.uid(3),'operator',true),(pg_temp.uid(100),pg_temp.uid(5),'super',true),(pg_temp.uid(101),pg_temp.uid(1),'super',true),(pg_temp.uid(102),pg_temp.uid(3),'super',true);
INSERT INTO public.workers VALUES(pg_temp.uid(6),pg_temp.uid(6),false),(pg_temp.uid(5),pg_temp.uid(5),true);
INSERT INTO public.facility_staff VALUES(pg_temp.uid(200),pg_temp.uid(100),pg_temp.uid(6)),(pg_temp.uid(201),pg_temp.uid(101),pg_temp.uid(5)),(pg_temp.uid(202),pg_temp.uid(101),pg_temp.uid(6));
INSERT INTO public.worker_bank_accounts VALUES(pg_temp.uid(300),pg_temp.uid(6),'TEST',extensions.pgp_sym_encrypt('000-TEST-1234','fixture-only-key'),'1234','TEST',true,NULL);
INSERT INTO public.gig_bank_account_shares VALUES(pg_temp.uid(200),pg_temp.uid(100),pg_temp.uid(6),pg_temp.uid(300),now()),(pg_temp.uid(202),pg_temp.uid(101),pg_temp.uid(6),pg_temp.uid(300),now());
INSERT INTO public.gig_payouts VALUES(pg_temp.uid(400),pg_temp.uid(100),pg_temp.uid(200));
INSERT INTO public.staff_wage_payments VALUES(pg_temp.uid(401),pg_temp.uid(100));
INSERT INTO public.wage_payment_instructions VALUES(pg_temp.uid(402),pg_temp.uid(100),pg_temp.uid(6));
-- APPLY_MIGRATION

CREATE FUNCTION pg_temp.check_access(user_number integer, visible integer, bank_allowed boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',pg_temp.uid(user_number)::text,true);
  SELECT count(*) INTO n FROM public.gig_payouts;
  IF n<>visible THEN RAISE EXCEPTION 'payout RLS mismatch for %: %',user_number,n; END IF;
  SELECT count(*) INTO n FROM public.staff_wage_payments;
  IF n<>visible THEN RAISE EXCEPTION 'staff payroll RLS mismatch for %',user_number; END IF;
  SELECT count(*) INTO n FROM public.wage_payment_instructions;
  IF n<>visible THEN RAISE EXCEPTION 'medical payroll RLS mismatch for %',user_number; END IF;
  BEGIN
    SELECT count(*) INTO n FROM public.get_gig_shared_bank_accounts(pg_temp.uid(100));
    IF NOT bank_allowed THEN RAISE EXCEPTION 'unexpected bank access'; END IF;
    IF n<>1 THEN RAISE EXCEPTION 'bank result mismatch'; END IF;
  EXCEPTION WHEN raise_exception THEN
    IF bank_allowed OR position('권한' IN SQLERRM)=0 THEN RAISE; END IF;
  END;
END;
$$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_access(1,1,true); -- owner
SELECT pg_temp.check_access(2,0,false); -- delegated, payroll disabled
SELECT pg_temp.check_access(3,1,true); -- delegated, payroll enabled
SELECT pg_temp.check_access(4,0,false); -- unrelated account
SELECT pg_temp.check_access(5,0,false); -- demo account with accidental real-facility grant
SELECT set_config('request.jwt.claim.sub',pg_temp.uid(1)::text,true);
DO $$ BEGIN IF public.facility_access_role(pg_temp.uid(101)) IS NOT NULL THEN RAISE EXCEPTION 'real admin crossed demo boundary'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub',pg_temp.uid(3)::text,true);
DO $$ BEGIN IF public.facility_access_role(pg_temp.uid(102)) IS NOT NULL THEN RAISE EXCEPTION 'inactive facility access'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub',pg_temp.uid(5)::text,true);
DO $$ BEGIN IF (SELECT count(*) FROM public.get_gig_shared_bank_accounts(pg_temp.uid(101)))<>0 THEN RAISE EXCEPTION 'legacy real bank leaked to demo'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub',pg_temp.uid(6)::text,true);
DO $$ BEGIN IF (SELECT count(*) FROM public.gig_payouts)<>1 THEN RAISE EXCEPTION 'worker own payout hidden'; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.facility_staff VALUES(pg_temp.uid(210),pg_temp.uid(101),pg_temp.uid(6));
    RAISE EXCEPTION 'real worker accepted demo facility';
  EXCEPTION WHEN raise_exception THEN IF position('서로 연결' IN SQLERRM)=0 THEN RAISE; END IF; END;
  BEGIN
    INSERT INTO public.facility_staff VALUES(pg_temp.uid(211),pg_temp.uid(100),pg_temp.uid(5));
    RAISE EXCEPTION 'demo worker accepted real facility';
  EXCEPTION WHEN raise_exception THEN IF position('서로 연결' IN SQLERRM)=0 THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.gig_bank_account_shares SET worker_id=pg_temp.uid(6) WHERE staff_id=pg_temp.uid(202);
    RAISE EXCEPTION 'mixed bank share allowed';
  EXCEPTION WHEN raise_exception THEN IF position('서로 연결' IN SQLERRM)=0 THEN RAISE; END IF; END;
END $$;
SELECT 'PASS: real authenticated RLS, bank RPC, owner/delegates/outsider, inactive facility, demo boundaries, worker own payout' AS result;
ROLLBACK;
